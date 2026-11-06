import { documentKind, getBaseName } from '@/lib/tauri/fs'
import { foldLine, foldText, originalSpan } from '@/components/studio/command-palette/fold-text'
import type { TextSearchHit } from '@/components/studio/command-palette/types'

export const MIN_QUERY_LENGTH = 2
export const DEBOUNCE_MS = 250
export const MAX_HITS = 100
export const MAX_FILE_BYTES = 1_048_576
export const READ_CONCURRENCY = 8
export const PREVIEW_MAX_CHARS = 100

/** A window of the line around the match, and where the match starts inside it (for highlighting). */
export function buildPreview(line: string, matchIndex: number, matchLength: number): { preview: string; matchStart: number } {
    const max = PREVIEW_MAX_CHARS
    const half = Math.floor((max - matchLength) / 2)
    let start = Math.max(0, matchIndex - half)
    const end = Math.min(line.length, start + max)

    if (end - start < max) {
        start = Math.max(0, end - max)
    }

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
    const hits: TextSearchHit[] = []
    let index = 0

    // Every path is scanned until the hit limit is reached or the search is cancelled.
    async function worker(): Promise<void> {
        while (!signal.aborted && hits.length < maxHits) {
            const currentIndex = index++
            if (currentIndex >= paths.length) return

            const pathHits = await scanPath(paths[currentIndex]!)
            if (signal.aborted) return

            for (const hit of pathHits) {
                if (hits.length >= maxHits) return
                hits.push(hit)
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, paths.length) }, () => worker())
    await Promise.all(workers)
    return hits
}

export type SearchWorkspaceContentOptions = {
    query: string
    paths: string[]
    openBuffers: Map<string, string>
    readFile: (path: string) => Promise<string>
    getFileSize?: (path: string) => Promise<number | null>
    signal: AbortSignal
    maxHits?: number
    maxFileBytes?: number
    concurrency?: number
}

export type SearchWorkspaceContentResult = {
    hits: TextSearchHit[]
    /** True when the hit limit was reached, so there may be more matches than returned. */
    capped: boolean
    /** Files that could not be read (deleted, renamed, or locked since the tree was loaded). */
    unreadableFiles: number
}

export async function searchWorkspaceContent(opts: SearchWorkspaceContentOptions): Promise<SearchWorkspaceContentResult> {
    const {
        query,
        paths,
        openBuffers,
        readFile,
        getFileSize,
        signal,
        maxHits = MAX_HITS,
        maxFileBytes = MAX_FILE_BYTES,
        concurrency = READ_CONCURRENCY,
    } = opts

    const hits: TextSearchHit[] = []
    const bufferPaths = new Set(openBuffers.keys())

    for (const [path, content] of openBuffers) {
        if (signal.aborted) return { hits: [], capped: false, unreadableFiles: 0 }
        const fileHits = searchInContent(content, query, path, 'buffer', maxHits - hits.length)
        hits.push(...fileHits)
        if (hits.length >= maxHits) {
            return { hits: hits.slice(0, maxHits), capped: true, unreadableFiles: 0 }
        }
    }

    const diskPaths = paths.filter((path) => !bufferPaths.has(path))

    let unreadableFiles = 0

    const scanDiskPath = async (path: string): Promise<TextSearchHit[]> => {
        try {
            if (getFileSize) {
                const size = await getFileSize(path)
                if (size !== null && size > maxFileBytes) return []
            }

            const content = await readFile(path)
            if (signal.aborted) return []
            if (content.length > maxFileBytes) return []

            return searchInContent(content, query, path, 'disk', maxHits)
        } catch {
            // One missing or locked file must not fail the whole search; skip it and count it.
            if (!signal.aborted) unreadableFiles++
            return []
        }
    }

    const diskHits = await scanDiskPaths(diskPaths, concurrency, maxHits - hits.length, scanDiskPath, signal)
    hits.push(...diskHits)

    return { hits: hits.slice(0, maxHits), capped: hits.length >= maxHits, unreadableFiles }
}

export function textHitToPaletteItem(hit: TextSearchHit): import('@/components/studio/command-palette/types').TextPaletteItem {
    const name = getBaseName(hit.path)
    return {
        kind: 'text',
        value: `text:${hit.path}:${hit.line}:${hit.column}`,
        searchText: `${name} ${hit.preview} ${hit.path}`,
        path: hit.path,
        name,
        documentKind: documentKind(name) ?? 'markdown',
        line: hit.line,
        column: hit.column,
        length: hit.length,
        preview: hit.preview,
        previewMatchStart: hit.previewMatchStart,
        source: hit.source,
    }
}
