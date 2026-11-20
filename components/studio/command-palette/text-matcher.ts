import { foldLine, foldText, normalizeLine, normalizeText, originalSpan, type FoldedLine } from '@/components/studio/command-palette/fold-text'

/**
 * What counts as a match in Find in Workspace, shared by the search, its regex worker and (later) Replace,
 * so they always agree. Pure: no React, no files, and safe to load in a worker.
 */

export type WorkspaceSearchOptions = {
    matchCase: boolean
    wholeWord: boolean
    useRegex: boolean
}

/** All off: the plain search, used everywhere the options don't apply. */
export const PLAIN_SEARCH_OPTIONS: WorkspaceSearchOptions = Object.freeze({ matchCase: false, wholeWord: false, useRegex: false })

/**
 * In regex mode, lines longer than this are skipped (and counted): one long minified line can take a
 * pattern far longer than the whole rest of a file.
 */
export const REGEX_MAX_LINE_LENGTH = 10_000

/** Splits text into words, as Intl.Segmenter with granularity 'word' does. Tests inject their own. */
export type WordSegmenter = {
    segment(input: string): Iterable<{ segment: string; index: number }>
}

export type TextMatcher = {
    /** The query as typed, which the regex worker compiles again on its side. */
    query: string
    options: WorkspaceSearchOptions
    /** Folded (or, with Match Case, only normalised) query, for the plain search. */
    needle: string
    /** Set in regex mode. */
    regex: RegExp | null
    /** The word splitter for Match Whole Word, or null for the built-in fallback. */
    segmenter: WordSegmenter | null
}

export type CompiledTextQuery = { ok: true; matcher: TextMatcher } | { ok: false; error: string }

/** A match inside one line, in the original line's positions (UTF-16 code units). */
export type LineSpan = { start: number; length: number }

/** A match in a file: its line (from 0) and where it sits in that line. */
export type TextMatch = LineSpan & { lineIndex: number }

export type CompileTextQueryOptions = {
    /** The word splitter to use. Leave it out for Intl.Segmenter, or pass null for the fallback. */
    segmenter?: WordSegmenter | null
}

let defaultWordSegmenter: WordSegmenter | null | undefined

function wordSegmenter(): WordSegmenter | null {
    if (defaultWordSegmenter === undefined) {
        defaultWordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
    }
    return defaultWordSegmenter
}

/**
 * The browser's message for a bad pattern, without the '/pattern/flags: ' part: 'Invalid regular
 * expression: /(/gu: Unterminated group' becomes 'Invalid regular expression: Unterminated group'.
 */
function regexErrorMessage(err: unknown, source: string, flags: string): string {
    const message = err instanceof Error ? err.message : String(err)
    const exact = `/${source}/${flags}: `
    const at = message.indexOf(exact)
    if (at !== -1) return message.slice(0, at) + message.slice(at + exact.length)
    return message.replace(/^(Invalid regular expression: )\/[\s\S]*\/[a-z]*: /, '$1')
}

/**
 * Compiles a Find in Workspace query for these options. A regex is compiled with the 'u' flag, plus 'i'
 * when Match Case is off; an invalid one gives its error message instead. Compiling never runs the
 * pattern, so it is safe on the main thread.
 */
export function compileTextQuery(query: string, options: WorkspaceSearchOptions, compileOptions: CompileTextQueryOptions = {}): CompiledTextQuery {
    const segmenter = compileOptions.segmenter === undefined ? wordSegmenter() : compileOptions.segmenter
    const base = { query, options: { ...options }, segmenter }

    if (!options.useRegex) {
        const needle = options.matchCase ? normalizeText(query) : foldText(query)
        return { ok: true, matcher: { ...base, needle, regex: null } }
    }

    // The pattern is composed like the text, so a composed 'café' finds one stored the macOS way.
    const source = query.normalize('NFC')
    const flags = options.matchCase ? 'gu' : 'giu'
    try {
        return { ok: true, matcher: { ...base, needle: source, regex: new RegExp(source, flags) } }
    } catch (err) {
        return { ok: false, error: regexErrorMessage(err, source, flags) }
    }
}

/** Letters, marks, numbers and connector punctuation: what words are made of when there is no segmenter. */
const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}\p{Pc}]$/u
/**
 * Chinese and Japanese have no spaces between words, so without a segmenter each of these characters
 * counts as a word on its own. Hangul is left out on purpose: Korean puts spaces between words.
 */
const STANDALONE_WORD_CHARACTER = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u
const MARK = /^\p{M}$/u

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** The code point that ends just before `at`. */
function codePointBefore(line: string, at: number): string {
    if (at >= 2 && isLowSurrogate(line.charCodeAt(at - 1)) && isHighSurrogate(line.charCodeAt(at - 2))) return line.slice(at - 2, at)
    return line.slice(at - 1, at)
}

/** How many code units the code point at `at` takes: 2 for an emoji, 1 otherwise (and at the end). */
function codePointLength(line: string, at: number): number {
    return isHighSurrogate(line.charCodeAt(at)) && isLowSurrogate(line.charCodeAt(at + 1)) ? 2 : 1
}

/** Whether a word may end before `at` and another start there, by the fallback rule. */
function isFallbackBoundary(line: string, at: number): boolean {
    if (at <= 0 || at >= line.length) return true
    // Never inside an emoji.
    if (isLowSurrogate(line.charCodeAt(at)) && isHighSurrogate(line.charCodeAt(at - 1))) return false
    const after = String.fromCodePoint(line.codePointAt(at)!)
    // An accent belongs to the letter before it.
    if (MARK.test(after)) return false
    const before = codePointBefore(line, at)
    if (!WORD_CHARACTER.test(before) || !WORD_CHARACTER.test(after)) return true
    return STANDALONE_WORD_CHARACTER.test(before) || STANDALONE_WORD_CHARACTER.test(after)
}

/** Where words start and end in one line: worked out only once the line has a match. */
type WordBoundaries = (at: number) => boolean

function wordBoundaries(line: string, segmenter: WordSegmenter | null): WordBoundaries {
    if (!segmenter) return (at) => isFallbackBoundary(line, at)
    const boundaries = new Set<number>([0, line.length])
    for (const { segment, index } of segmenter.segment(line)) {
        boundaries.add(index)
        boundaries.add(index + segment.length)
    }
    return (at) => boundaries.has(at)
}

/** Strips the '\r' a CRLF file leaves at the end of each line, so 'foo$' matches there. */
function withoutCarriageReturn(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Finds the matches in one line, in the original line's positions, up to `maxMatches`. Never an empty
 * match. With Match Whole Word, a match must start and end on word boundaries; when one doesn't, the
 * search goes on from the next character, so 'aa' still finds the second pair in 'aaa aa'.
 */
export function matchLine(line: string, matcher: TextMatcher, maxMatches = Number.POSITIVE_INFINITY): LineSpan[] {
    const spans: LineSpan[] = []
    if (maxMatches <= 0) return spans
    const text = withoutCarriageReturn(line)
    const { options } = matcher
    const mapped: FoldedLine = options.useRegex || options.matchCase ? normalizeLine(text) : foldLine(text)
    const haystack = mapped.folded
    let boundaries: WordBoundaries | null = null
    const isWholeWord = (span: LineSpan) => {
        boundaries ??= wordBoundaries(text, matcher.segmenter)
        return boundaries(span.start) && boundaries(span.start + span.length)
    }

    if (matcher.regex) {
        const regex = matcher.regex
        // The 'g' flag keeps its place in lastIndex; each line starts again from 0.
        regex.lastIndex = 0
        while (spans.length < maxMatches && regex.lastIndex <= haystack.length) {
            const found = regex.exec(haystack)
            if (!found) break
            const index = found.index
            const length = found[0].length
            if (length > 0) {
                const span = originalSpan(mapped, index, length)
                if (!options.wholeWord || isWholeWord(span)) {
                    spans.push(span)
                    regex.lastIndex = index + length
                    continue
                }
            }
            // An empty match (from '^' or 'x*'), or one that isn't a whole word: go on from the next character.
            regex.lastIndex = index + codePointLength(haystack, index)
        }
        return spans
    }

    const needle = matcher.needle
    if (!needle) return spans
    let from = 0
    while (spans.length < maxMatches) {
        const index = haystack.indexOf(needle, from)
        if (index === -1) break
        const span = originalSpan(mapped, index, needle.length)
        if (!options.wholeWord || isWholeWord(span)) {
            spans.push(span)
            from = index + needle.length
        } else {
            from = index + codePointLength(haystack, index)
        }
    }
    return spans
}

export type MatchTextResult = {
    matches: TextMatch[]
    /** Lines left out because they are longer than REGEX_MAX_LINE_LENGTH (regex mode only). */
    longLinesSkipped: number
}

/** Finds the matches in a whole file's text, line by line, up to `maxMatches` (no limit when left out). */
export function matchText(text: string, matcher: TextMatcher, maxMatches = Number.POSITIVE_INFINITY): MatchTextResult {
    const matches: TextMatch[] = []
    let longLinesSkipped = 0
    const lines = text.split('\n')
    for (let lineIndex = 0; lineIndex < lines.length && matches.length < maxMatches; lineIndex++) {
        const line = lines[lineIndex]!
        if (matcher.options.useRegex && withoutCarriageReturn(line).length > REGEX_MAX_LINE_LENGTH) {
            longLinesSkipped++
            continue
        }
        for (const span of matchLine(line, matcher, maxMatches - matches.length)) matches.push({ lineIndex, ...span })
    }
    return { matches, longLinesSkipped }
}
