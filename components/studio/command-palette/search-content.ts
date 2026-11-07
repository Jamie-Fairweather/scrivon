import { documentKind, getBaseName, stampChanged } from '@/lib/tauri/fs'
import type { FileStamp } from '@/lib/workspace/types'
import { foldLine, foldText, originalSpan } from '@/components/studio/command-palette/fold-text'
import { relativePath } from '@/components/studio/command-palette/search-files'
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

/** A window of the line around the match, and where the match starts inside it (for highlighting). */
export function buildPreview(line: string, matchIndex: number, matchLength: number): { preview: string; matchStart: number } {
    const max = PREVIEW_MAX_CHARS
    const half = Math.floor((max - matchLength) / 2)
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
    return { preview, matchStart }
}

function searchInContent(content: string, query: string, path: string, source: 'buffer' | 'disk', maxHits: number): TextSearchHit[] {
    const hits: TextSearchHit[] = []
    const needle = foldText(query)
    if (!needle) return hits
    const lines = content.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length && hits.length < maxHits; lineIdx++) {
        const line = lines[lineIdx]!
        const folded = foldLine(line)
        let col = 0

        while (col < folded.folded.length && hits.length < maxHits) {
            const idx = folded.folded.indexOf(needle, col)
            if (idx === -1) break

            // Report the match where it sits in the original line, which folding may have shifted.
            const match = originalSpan(folded, idx, needle.length)
            const { preview, matchStart } = buildPreview(line, match.start, match.length)
            hits.push({
                path,
                line: lineIdx + 1,
                column: match.start + 1,
                length: match.length,
                preview,
                previewMatchStart: matchStart,
                source,
            })
            col = idx + needle.length
        }
    }

    return hits
}

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
    query: string
    paths: string[]
    openBuffers: Map<string, string>
    readFile: (path: string) => Promise<string>
    /** The file's size and modified time, or null when they can't be read. */
    getFileStamp?: (path: string) => Promise<FileStamp | null>
    /** Reuses file text from earlier searches; only used when the file's stamp is known. */
    cache?: ContentCache
    signal: AbortSignal
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
}

export async function searchWorkspaceContent(opts: SearchWorkspaceContentOptions): Promise<SearchWorkspaceContentResult> {
    const {
        query,
        paths,
        openBuffers,
        readFile,
        getFileStamp,
        cache,
        signal,
        maxHits = MAX_HITS,
        maxHitsPerFile = MAX_HITS_PER_FILE,
        maxFileBytes = MAX_FILE_BYTES,
        concurrency = READ_CONCURRENCY,
    } = opts

    const hits: TextSearchHit[] = []
    const bufferPaths = new Set(openBuffers.keys())
    let truncatedFiles = 0

    // Looks one hit past the per-file limit to tell whether the file had more.
    const searchFile = (content: string, path: string, source: 'buffer' | 'disk'): TextSearchHit[] => {
        const fileHits = searchInContent(content, query, path, source, maxHitsPerFile + 1)
        if (fileHits.length <= maxHitsPerFile) return fileHits
        truncatedFiles++
        return fileHits.slice(0, maxHitsPerFile)
    }

    for (const [path, content] of openBuffers) {
        if (signal.aborted) return { hits: [], capped: false, unreadableFiles: 0, truncatedFiles: 0 }
        hits.push(...searchFile(content, path, 'buffer'))
        if (hits.length >= maxHits) {
            return { hits: hits.slice(0, maxHits), capped: true, unreadableFiles: 0, truncatedFiles }
        }
    }

    const diskPaths = paths.filter((path) => !bufferPaths.has(path))

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
            if (signal.aborted) return []
            if (content.length > maxFileBytes) return []

            return searchFile(content, path, 'disk')
        } catch {
            // One missing or locked file must not fail the whole search; skip it and count it.
            if (!signal.aborted) unreadableFiles++
            return []
        }
    }

    const diskHits = await scanDiskPaths(diskPaths, concurrency, maxHits - hits.length, scanDiskPath, signal)
    hits.push(...diskHits)

    return { hits: hits.slice(0, maxHits), capped: hits.length >= maxHits, unreadableFiles, truncatedFiles }
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
        source: hit.source,
    }
}
