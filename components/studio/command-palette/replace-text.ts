import { originalSpan, type FoldedLine } from '@/components/studio/command-palette/fold-text'
import { forEachLineMatch, isLongLineForRegex, type TextMatch, type TextMatcher } from '@/components/studio/command-palette/text-matcher'
import { rangesOfOffsets, type TextEdit } from '@/lib/workspace/text-edits'

/**
 * Replace in Workspace's text work: what each match of a query becomes, and the file's text or editor edits
 * with them made. It finds matches exactly as Find in Workspace does (text-matcher.ts), so a replace never
 * changes anything the search didn't show. Pure: no React, no files, and safe to load in the regex worker,
 * which runs it for regular expressions so a slow pattern can't freeze the window.
 */

/** A match and what replaces it, in the original line's positions (UTF-16 code units). */
export type TextReplacement = TextMatch & {
    /** The text matched, as it is in the file. */
    oldText: string
    /** What it becomes. */
    newText: string
}

export type FindReplacementsResult = {
    replacements: TextReplacement[]
    /** Lines left out because they are longer than REGEX_MAX_LINE_LENGTH (regex mode only). */
    longLinesSkipped: number
}

/** A regex compiled again with the 'd' flag, so each group's place in the line is known. Kept per pattern. */
const withIndices = new WeakMap<RegExp, RegExp>()

function regexWithIndices(regex: RegExp): RegExp {
    let compiled = withIndices.get(regex)
    if (!compiled) {
        compiled = regex.hasIndices ? regex : new RegExp(regex.source, `${regex.flags}d`)
        withIndices.set(regex, compiled)
    }
    return compiled
}

/** A group's text, read from the original line (not the normalised one searched), or '' when it took no part. */
function groupText(text: string, mapped: FoldedLine, indices: [number, number] | undefined): string {
    if (!indices) return ''
    const [start, end] = indices
    if (end <= start) return ''
    const span = originalSpan(mapped, start, end - start)
    return text.slice(span.start, span.start + span.length)
}

const DIGIT = /[0-9]/

/**
 * What a regex match becomes, by the rules String.prototype.replace follows: '$$' is '$', '$&' the match,
 * '$`' and "$'" the line before and after it, '$1' to '$99' a numbered group and '$<name>' a named one.
 * Anything else stays as typed. Groups are read from the original line, so they keep its spelling.
 */
export function expandReplacement(
    template: string,
    text: string,
    span: { start: number; length: number },
    mapped: FoldedLine,
    found: RegExpExecArray
): string {
    if (!template.includes('$')) return template
    const groupCount = found.length - 1
    const indices = found.indices
    const group = (n: number) => (indices ? groupText(text, mapped, indices[n]) : (found[n] ?? ''))
    let result = ''
    let i = 0
    while (i < template.length) {
        const char = template[i]!
        if (char !== '$' || i + 1 >= template.length) {
            result += char
            i++
            continue
        }
        const next = template[i + 1]!
        if (next === '$') {
            result += '$'
            i += 2
        } else if (next === '&') {
            result += text.slice(span.start, span.start + span.length)
            i += 2
        } else if (next === '`') {
            result += text.slice(0, span.start)
            i += 2
        } else if (next === "'") {
            result += text.slice(span.start + span.length)
            i += 2
        } else if (DIGIT.test(next)) {
            const two = i + 2 < template.length && DIGIT.test(template[i + 2]!) ? Number(template.slice(i + 1, i + 3)) : null
            const one = Number(next)
            if (two !== null && two >= 1 && two <= groupCount) {
                result += group(two)
                i += 3
            } else if (one >= 1 && one <= groupCount) {
                result += group(one)
                i += 2
            } else {
                result += '$'
                i++
            }
        } else if (next === '<' && found.groups) {
            const close = template.indexOf('>', i + 2)
            if (close === -1) {
                result += '$'
                i++
                continue
            }
            const name = template.slice(i + 2, close)
            const at = indices?.groups?.[name]
            result += indices ? groupText(text, mapped, at) : (found.groups[name] ?? '')
            i = close + 1
        } else {
            result += '$'
            i++
        }
    }
    return result
}

const LINE_BREAK = /[\r\n]/

/**
 * Whether a regular expression can match empty text ('^', '$', 'x*'). Its empty matches are never listed or
 * replaced, so with no other matches the palette says why nothing is there to replace. Testing it on '' is safe
 * on this thread: no pattern can take long on no text.
 */
export function canMatchEmptyText(matcher: TextMatcher): boolean {
    if (!matcher.options.useRegex || !matcher.regex) return false
    const { source, flags } = matcher.regex
    return new RegExp(source, flags.replace(/[gyd]/g, '')).test('')
}

/** Shown instead of 'no results' when Replace has only empty matches to work with. */
export const EMPTY_MATCH_REPLACE_HINT =
    'Nothing to replace. Replace only changes text a match covers, so a pattern that matches empty text, like ^ or $, ' +
    'adds nothing. To add text at the start of each line, search for ^(.) and replace with your text followed by $1.'

/**
 * Every match in `text` (up to `maxMatches`) and what it becomes. With Use Regular Expression off the
 * replacement is put in literally ('$1' stays '$1'); with it on, '$1', '$<name>' and '$&' are filled in.
 * Lines are matched without the '\r' of a CRLF file, so '$' matches before it, and no match or replacement
 * may remove or add a line break: a match that would is left out. Empty matches are never replaced, as
 * Find in Workspace never shows them, so '^' or 'x*' can't add text twice (EMPTY_MATCH_REPLACE_HINT says so).
 */
export function findReplacements(
    text: string,
    matcher: TextMatcher,
    replacement: string,
    maxMatches = Number.POSITIVE_INFINITY
): FindReplacementsResult {
    const replacements: TextReplacement[] = []
    let longLinesSkipped = 0
    // A replacement can't make a new line: that is a multi-line edit, which Replace doesn't do.
    if (LINE_BREAK.test(replacement)) return { replacements, longLinesSkipped }
    const useRegex = matcher.options.useRegex && matcher.regex !== null
    const lineMatcher = useRegex ? { ...matcher, regex: regexWithIndices(matcher.regex!) } : matcher
    const lines = text.split('\n')
    for (let lineIndex = 0; lineIndex < lines.length && replacements.length < maxMatches; lineIndex++) {
        const line = lines[lineIndex]!
        if (isLongLineForRegex(line, matcher)) {
            longLinesSkipped++
            continue
        }
        forEachLineMatch(line, lineMatcher, maxMatches - replacements.length, (span, { text: lineText, mapped, found }) => {
            const oldText = lineText.slice(span.start, span.start + span.length)
            // A lone '\r' inside a line (an old Mac line break) is a line break to the editor: never removed.
            if (oldText.includes('\r')) return
            const newText = useRegex && found ? expandReplacement(replacement, lineText, span, mapped, found) : replacement
            if (LINE_BREAK.test(newText)) return
            replacements.push({ lineIndex, start: span.start, length: span.length, oldText, newText })
        })
    }
    return { replacements, longLinesSkipped }
}

/** Where each line starts in `text`, its lines split at '\n' as matchText splits them. */
function lineStarts(text: string): number[] {
    const starts = [0]
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
    return starts
}

/** Each replacement as offsets into `text`, in order. */
export function replacementOffsets(text: string, replacements: readonly TextReplacement[]): Array<{ start: number; end: number; text: string }> {
    const starts = lineStarts(text)
    return [...replacements]
        .sort((a, b) => a.lineIndex - b.lineIndex || a.start - b.start)
        .map((r) => {
            const start = starts[r.lineIndex]! + r.start
            return { start, end: start + r.length, text: r.newText }
        })
}

/** `text` with every replacement made. Everything else, line breaks included, stays as it was. */
export function applyReplacements(text: string, replacements: readonly TextReplacement[]): string {
    let result = ''
    let from = 0
    for (const { start, end, text: newText } of replacementOffsets(text, replacements)) {
        result += text.slice(from, start) + newText
        from = end
    }
    return result + text.slice(from)
}

/** The replacements as editor edits on `text` (a tab's text), for applyTabEdits: one undo step for all of them. */
export function replacementEdits(text: string, replacements: readonly TextReplacement[]): TextEdit[] {
    const offsets = replacementOffsets(text, replacements)
    const ranges = rangesOfOffsets(text, offsets)
    return offsets.map((offset, i) => ({ range: ranges[i]!, text: offset.text }))
}

/**
 * Stands for a file's replacements, so a later pass can tell whether the file still has exactly the matches
 * that were counted and confirmed: the same places, the same text, the same result.
 */
export function replacementSignature(replacements: readonly TextReplacement[]): string {
    return JSON.stringify(replacements.map((r) => [r.lineIndex, r.start, r.oldText, r.newText]))
}
