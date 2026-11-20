import { comparablePath, documentKind, getBaseName, stampChanged } from '@/lib/tauri/fs'
import type { FileStamp } from '@/lib/workspace/types'
import {
    matchFile as defaultMatchFile,
    replaceFile as defaultReplaceFile,
    REGEX_FILE_TIME_LIMIT_MS,
    type MatchFile,
    type ReplaceFile,
} from '@/components/studio/command-palette/regex-match-client'
import { findReplacements, type TextReplacement } from '@/components/studio/command-palette/replace-text'
import { relativePath } from '@/components/studio/command-palette/search-files'
import { matchText, type TextMatch, type TextMatcher } from '@/components/studio/command-palette/text-matcher'
import type { PaletteMode, TextSearchHit } from '@/components/studio/command-palette/types'

export const MIN_QUERY_LENGTH = 2
export const DEBOUNCE_MS = 250
export const MAX_HITS = 100
/** So one file full of a common word can't push every other file out of the results. */
export const MAX_HITS_PER_FILE = 10
export const MAX_FILE_BYTES = 1_048_576
export const READ_CONCURRENCY = 8
export const PREVIEW_MAX_CHARS = 100
/** One Chinese, Japanese or Korean character is often a whole word (図, 猫, 표). */
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * Whether a query is long enough to search file contents. Find in Workspace searches from the
 * first character (the hit limits keep that cheap). Elsewhere it takes two characters, counted
 * as characters rather than UTF-16 units, or a single Chinese, Japanese or Korean one.
 */
export function meetsTextQueryMinimum(query: string, mode: PaletteMode): boolean {
    if (!query) return false
    if (mode === 'text') return true
    if (CJK_CHARACTER.test(query)) return true
    return [...query].length >= MIN_QUERY_LENGTH
}

/** Upper bound on file text kept between searches, so a huge workspace can't fill memory. */
export const MAX_CACHED_CHARS = 16_000_000

/**
 * Disk file text kept between searches while the palette is open, so each pause in typing
 * doesn't read every file again. A file's text is reused only while its size and modified time on
 * disk are unchanged, so an edit made in another app that keeps the size is still picked up.
 */
export type ContentCache = {
    get: (path: string, stamp: FileStamp) => string | undefined
    set: (path: string, stamp: FileStamp, text: string) => void
    clear: () => void
}

export function createContentCache(maxChars = MAX_CACHED_CHARS): ContentCache {
    const files = new Map<string, { stamp: FileStamp; text: string }>()
    let chars = 0

    return {
        get(path, stamp) {
            const cached = files.get(path)
            return cached && !stampChanged(cached.stamp, stamp) ? cached.text : undefined
        },
        set(path, stamp, text) {
            const previous = files.get(path)
            if (previous) {
                chars -= previous.text.length
                files.delete(path)
            }
            // Once full, further files are simply read from disk each time.
            if (chars + text.length > maxChars) return
            files.set(path, { stamp, text })
            chars += text.length
        },
        clear() {
            files.clear()
            chars = 0
        },
    }
}

let graphemeSegmenter: Intl.Segmenter | null | undefined

function segmenter(): Intl.Segmenter | null {
    if (graphemeSegmenter === undefined) {
        graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
    }
    return graphemeSegmenter
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * Widens `start..end` so neither end cuts through a character as the user sees it: an emoji (also one
 * joined from several, or a flag), or a letter with its accents. The whole line is segmented, since a
 * flag's two halves can only be paired by counting from the start of the line.
 */
function widenToWholeCharacters(line: string, start: number, end: number): { start: number; end: number } {
    const seg = segmenter()
    if (seg && (start > 0 || end < line.length)) {
        const segments = seg.segment(line)
        if (start > 0 && start < line.length) start = segments.containing(start)?.index ?? start
        if (end > 0 && end < line.length) {
            const around = segments.containing(end)
            if (around && around.index < end) end = around.index + around.segment.length
        }
    }
    // Never half of a surrogate pair, which shows as a box, even where grapheme segmenting isn't available.
    if (start > 0 && isLowSurrogate(line.charCodeAt(start)) && isHighSurrogate(line.charCodeAt(start - 1))) start -= 1
    if (end > 0 && end < line.length && isHighSurrogate(line.charCodeAt(end - 1)) && isLowSurrogate(line.charCodeAt(end))) end += 1
    return { start, end }
}

/**
 * A window of the line around the match, where the match starts inside it, and how much of it the
 * window shows (for highlighting). A match longer than the window starts the window.
 */
export function buildPreview(line: string, matchIndex: number, matchLength: number): { preview: string; matchStart: number; matchLength: number } {
    const max = PREVIEW_MAX_CHARS
    const half = Math.max(0, Math.floor((max - matchLength) / 2))
    let cutStart = Math.max(0, matchIndex - half)
    const cutEnd = Math.min(line.length, cutStart + max)

    if (cutEnd - cutStart < max) {
        cutStart = Math.max(0, cutEnd - max)
    }
    const { start, end } = widenToWholeCharacters(line, cutStart, cutEnd)

    let preview = line.slice(start, end)
    let matchStart = matchIndex - start
    if (start > 0) {
        preview = `…${preview}`
        matchStart += 1
    }
    if (end < line.length) preview = `${preview}…`
    // Only the part of the match inside the window, never the '…' after it.
    const shown = Math.max(0, Math.min(matchLength, end - matchIndex))
    return { preview, matchStart, matchLength: shown }
}

/** Turns matches (in original-line positions) into hits with their previews. */
function matchesToHits(content: string, matches: Array<TextMatch | TextReplacement>, path: string, source: 'buffer' | 'disk'): TextSearchHit[] {
    if (matches.length === 0) return []
    const lines = content.split('\n')
    return matches.map((match) => {
        const { lineIndex, start, length } = match
        const { preview, matchStart, matchLength } = buildPreview(lines[lineIndex]!, start, length)
        const hit: TextSearchHit = {
            path,
            line: lineIndex + 1,
            column: start + 1,
            length,
            preview,
            previewMatchStart: matchStart,
            previewMatchLength: matchLength,
            source,
        }
        if ('newText' in match) hit.newText = match.newText
        return hit
    })
}

/** An open tab's file and its text as the tab has it now, unsaved edits included. */
export type OpenFileText = { path: string; content: string }

/** The open tabs' texts, as tabs (`{ path, content }`) or as a map from path to text. */
export type OpenFileTexts = Iterable<OpenFileText> | ReadonlyMap<string, string>

function* eachOpenText(open: OpenFileTexts): Iterable<OpenFileText> {
    if (open instanceof Map) {
        for (const [path, content] of open as ReadonlyMap<string, string>) yield { path, content }
    } else {
        yield* open as Iterable<OpenFileText>
    }
}

/**
 * The text of `path` from the tab it is open in, however its path is written (`Docs\Other.MD` finds the tab opened
 * as `docs/other.md`, see samePath), or undefined when no tab has it. Never reads the disk.
 */
export function openTabText(open: OpenFileTexts, path: string): string | undefined {
    const key = comparablePath(path)
    for (const tab of eachOpenText(open)) {
        if (comparablePath(tab.path) === key) return tab.content
    }
    return undefined
}

/**
 * A file's text: the open tab's when a tab has it (so unsaved edits win over what is on disk), otherwise what
 * `readFile` reads from disk. Without a reader the disk is never read, and a file no tab has gives undefined.
 */
export async function fileText(path: string, open: OpenFileTexts, readFile?: (path: string) => Promise<string>): Promise<string | undefined> {
    const inTab = openTabText(open, path)
    if (inTab !== undefined || !readFile) return inTab
    return readFile(path)
}

/** Why a regex search stopped before it had looked at every file. */
export type SearchStop = { reason: 'timedOut'; path: string } | { reason: 'unavailable' }

async function scanDiskPaths(
    paths: string[],
    concurrency: number,
    maxHits: number,
    scanPath: (path: string) => Promise<TextSearchHit[]>,
    signal: AbortSignal
): Promise<TextSearchHit[]> {
    // Hits are kept by file position, so results follow the file tree rather than whichever read
    // finishes first. Paths are claimed in order and every started scan is awaited, so the scanned
    // files are always the first k paths and the first maxHits hits are the same on every run.
    const hitsByPath: TextSearchHit[][] = []
    let found = 0
    let index = 0

    // Every path is scanned until the hit limit is reached or the search is cancelled.
    async function worker(): Promise<void> {
        while (!signal.aborted && found < maxHits) {
            const currentIndex = index++
            if (currentIndex >= paths.length) return

            const pathHits = await scanPath(paths[currentIndex]!)
            if (signal.aborted) return

            hitsByPath[currentIndex] = pathHits
            found += pathHits.length
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, paths.length) }, () => worker())
    await Promise.all(workers)
    return hitsByPath.flat().slice(0, maxHits)
}

export type SearchWorkspaceContentOptions = {
    /** The query compiled for the search's options (compileTextQuery). */
    matcher: TextMatcher
    paths: string[]
    openBuffers: Map<string, string>
    readFile: (path: string) => Promise<string>
    /** The file's size and modified time, or null when they can't be read. */
    getFileStamp?: (path: string) => Promise<FileStamp | null>
    /** Reuses file text from earlier searches; only used when the file's stamp is known. */
    cache?: ContentCache
    signal: AbortSignal
    /** Runs a regex search in the worker. Only used in regex mode; the app's own worker by default. */
    matchFile?: MatchFile
    /**
     * Set for Replace in Workspace's preview: each hit then says what its match becomes (`newText`), and only
     * matches Replace would change are found (findReplacements). Null or left out for a plain search.
     */
    replacement?: string | null
    /** Works out a regex search's replacements in the worker. Only used in regex mode with a replacement. */
    replaceFile?: ReplaceFile
    /** How long the worker gets for each file in regex mode. */
    regexTimeLimitMs?: number
    maxHits?: number
    maxHitsPerFile?: number
    maxFileBytes?: number
    concurrency?: number
}

export type SearchWorkspaceContentResult = {
    hits: TextSearchHit[]
    /** True when the hit limit was reached, so there may be more matches than returned. */
    capped: boolean
    /** Files that could not be read (deleted, renamed, or locked since the tree was loaded). */
    unreadableFiles: number
    /** Files with more matches than the per-file limit shows. */
    truncatedFiles: number
    /** Which files those are, so the results can say '10+' for them. */
    truncatedPaths: string[]
    /** Lines skipped in regex mode for being longer than REGEX_MAX_LINE_LENGTH. */
    longLinesSkipped: number
    /** Set when a regex search stopped early. The hits found before it stopped are kept. */
    stopped: SearchStop | null
}

const NO_RESULT: SearchWorkspaceContentResult = {
    hits: [],
    capped: false,
    unreadableFiles: 0,
    truncatedFiles: 0,
    truncatedPaths: [],
    longLinesSkipped: 0,
    stopped: null,
}

export async function searchWorkspaceContent(opts: SearchWorkspaceContentOptions): Promise<SearchWorkspaceContentResult> {
    const {
        matcher,
        paths,
        openBuffers,
        readFile,
        getFileStamp,
        cache,
        signal,
        matchFile = defaultMatchFile,
        replacement = null,
        replaceFile = defaultReplaceFile,
        regexTimeLimitMs = REGEX_FILE_TIME_LIMIT_MS,
        maxHits = MAX_HITS,
        maxHitsPerFile = MAX_HITS_PER_FILE,
        maxFileBytes = MAX_FILE_BYTES,
        concurrency = READ_CONCURRENCY,
    } = opts

    const hits: TextSearchHit[] = []
    // An open file is searched in its tab, never on disk too, however the folder listing spells its path
    // (C:\Notes\A.md in the tab, c:/notes/a.md in the listing).
    const bufferPaths = new Set([...openBuffers.keys()].map(comparablePath))
    let truncatedFiles = 0
    // How many matches each file had (one past the per-file limit at most), to tell which ones the results cut short.
    const foundCounts = new Map<string, number>()
    let longLinesSkipped = 0
    let stopped: SearchStop | null = null
    // Aborted with the caller's signal, or when a regex search stops (a file took too long), so the files
    // still being read or waiting for the worker are dropped.
    const scan = new AbortController()
    const stopScan = () => scan.abort()
    if (signal.aborted) return NO_RESULT
    signal.addEventListener('abort', stopScan, { once: true })

    /** The matches in one file: on this thread for a plain search, in the worker for a regex. Null once the search stopped. */
    const findMatches = async (content: string, path: string): Promise<Array<TextMatch | TextReplacement> | null> => {
        // Looks one hit past the per-file limit to tell whether the file had more.
        const limit = maxHitsPerFile + 1
        if (!matcher.options.useRegex) {
            return replacement === null
                ? matchText(content, matcher, limit).matches
                : findReplacements(content, matcher, replacement, limit).replacements
        }

        const matchOptions = { maxHits: limit, timeLimitMs: regexTimeLimitMs, signal: scan.signal }
        const result =
            replacement === null
                ? await matchFile(content, matcher.query, matcher.options, matchOptions)
                : await replaceFile(content, matcher.query, matcher.options, replacement, matchOptions)
        if (result.type === 'matches' || result.type === 'replacements') {
            longLinesSkipped += result.longLinesSkipped
            return result.type === 'matches' ? result.matches : result.replacements
        }
        if (result.type !== 'aborted' && !stopped) {
            stopped = result.type === 'timedOut' ? { reason: 'timedOut', path } : { reason: 'unavailable' }
            scan.abort()
        }
        return null
    }

    const searchFile = async (content: string, path: string, source: 'buffer' | 'disk'): Promise<TextSearchHit[]> => {
        const matches = await findMatches(content, path)
        if (!matches) return []
        const fileHits = matchesToHits(content, matches, path, source)
        foundCounts.set(path, fileHits.length)
        if (fileHits.length <= maxHitsPerFile) return fileHits
        truncatedFiles++
        return fileHits.slice(0, maxHitsPerFile)
    }

    const finish = (capped: boolean, unreadableFiles: number): SearchWorkspaceContentResult => {
        signal.removeEventListener('abort', stopScan)
        const shown = hits.slice(0, maxHits)
        const shownCounts = new Map<string, number>()
        for (const hit of shown) shownCounts.set(hit.path, (shownCounts.get(hit.path) ?? 0) + 1)
        // Cut short by the per-file limit, or by the overall one part way through the file.
        const truncatedPaths = [...shownCounts].filter(([path, count]) => (foundCounts.get(path) ?? 0) > count).map(([path]) => path)
        return { hits: shown, capped, unreadableFiles, truncatedFiles, truncatedPaths, longLinesSkipped, stopped }
    }

    for (const [path, content] of openBuffers) {
        if (signal.aborted) return NO_RESULT
        hits.push(...(await searchFile(content, path, 'buffer')))
        if (hits.length >= maxHits) return finish(true, 0)
        if (scan.signal.aborted) return signal.aborted ? NO_RESULT : finish(false, 0)
    }

    const diskPaths = paths.filter((path) => !bufferPaths.has(comparablePath(path)))

    let unreadableFiles = 0

    const scanDiskPath = async (path: string): Promise<TextSearchHit[]> => {
        try {
            const stamp = getFileStamp ? await getFileStamp(path) : null
            if (stamp !== null && stamp.size > maxFileBytes) return []

            let content = stamp !== null ? cache?.get(path, stamp) : undefined
            if (content === undefined) {
                content = await readFile(path)
                // Kept even if this search was cancelled meanwhile, so the next one can use it.
                if (stamp !== null) cache?.set(path, stamp, content)
            }
            if (scan.signal.aborted) return []
            if (content.length > maxFileBytes) return []

            return await searchFile(content, path, 'disk')
        } catch {
            // One missing or locked file must not fail the whole search; skip it and count it.
            if (!scan.signal.aborted) unreadableFiles++
            return []
        }
    }

    const diskHits = await scanDiskPaths(diskPaths, concurrency, maxHits - hits.length, scanDiskPath, scan.signal)
    if (signal.aborted) return NO_RESULT
    hits.push(...diskHits)

    return finish(hits.length >= maxHits, unreadableFiles)
}

export function textHitToPaletteItem(hit: TextSearchHit, workspaceRoot: string): import('@/components/studio/command-palette/types').TextPaletteItem {
    const name = getBaseName(hit.path)
    return {
        kind: 'text',
        value: `text:${hit.path}:${hit.line}:${hit.column}`,
        searchText: `${name} ${hit.preview} ${hit.path}`,
        path: hit.path,
        name,
        relativePath: relativePath(workspaceRoot, hit.path),
        documentKind: documentKind(name) ?? 'markdown',
        line: hit.line,
        column: hit.column,
        length: hit.length,
        preview: hit.preview,
        previewMatchStart: hit.previewMatchStart,
        previewMatchLength: hit.previewMatchLength,
        source: hit.source,
        ...(hit.newText !== undefined ? { newText: hit.newText } : {}),
    }
}
