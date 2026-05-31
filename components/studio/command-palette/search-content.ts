import { getBaseName } from '@/lib/tauri/fs'
import type { TextSearchHit } from '@/components/studio/command-palette/types'

export const MIN_QUERY_LENGTH = 2
export const DEBOUNCE_MS = 250
export const MAX_HITS = 100
export const MAX_FILES_SCANNED = 50
export const MAX_FILE_BYTES = 1_048_576
export const READ_CONCURRENCY = 8
export const PREVIEW_MAX_CHARS = 100

export function buildPreview(line: string, matchIndex: number, matchLength: number): string {
    const max = PREVIEW_MAX_CHARS
    const half = Math.floor((max - matchLength) / 2)
    let start = Math.max(0, matchIndex - half)
    const end = Math.min(line.length, start + max)

    if (end - start < max) {
        start = Math.max(0, end - max)
    }

    let preview = line.slice(start, end)
    if (start > 0) preview = `…${preview}`
    if (end < line.length) preview = `${preview}…`
    return preview
}

function searchInContent(content: string, query: string, path: string, source: 'buffer' | 'disk', maxHits: number): TextSearchHit[] {
    const hits: TextSearchHit[] = []
    const lowerQuery = query.toLowerCase()
    const lines = content.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length && hits.length < maxHits; lineIdx++) {
        const line = lines[lineIdx]!
        const lowerLine = line.toLowerCase()
        let col = 0

        while (col < lowerLine.length && hits.length < maxHits) {
            const idx = lowerLine.indexOf(lowerQuery, col)
            if (idx === -1) break

            hits.push({
                path,
                line: lineIdx + 1,
                column: idx + 1,
                length: query.length,
                preview: buildPreview(line, idx, query.length),
                source,
            })
            col = idx + lowerQuery.length
        }
    }

    return hits
}

async function scanDiskPaths(
    paths: string[],
    concurrency: number,
    maxFilesScanned: number,
    maxHits: number,
    scanPath: (path: string) => Promise<TextSearchHit[]>,
    signal: AbortSignal
): Promise<{ hits: TextSearchHit[]; filesScanned: number }> {
    const hits: TextSearchHit[] = []
    let index = 0
    let filesScanned = 0

    async function worker(): Promise<void> {
        while (!signal.aborted && hits.length < maxHits && filesScanned < maxFilesScanned) {
            const currentIndex = index++
            if (currentIndex >= paths.length) return

            filesScanned++
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
    return { hits, filesScanned }
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
    maxFilesScanned?: number
    concurrency?: number
}

export type SearchWorkspaceContentResult = {
    hits: TextSearchHit[]
    capped: boolean
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
        maxFilesScanned = MAX_FILES_SCANNED,
        concurrency = READ_CONCURRENCY,
    } = opts

    const hits: TextSearchHit[] = []
    const bufferPaths = new Set(openBuffers.keys())

    for (const [path, content] of openBuffers) {
        if (signal.aborted) return { hits: [], capped: false }
        const fileHits = searchInContent(content, query, path, 'buffer', maxHits - hits.length)
        hits.push(...fileHits)
        if (hits.length >= maxHits) {
            return { hits: hits.slice(0, maxHits), capped: true }
        }
    }

    const diskPaths = paths.filter((path) => !bufferPaths.has(path))

    const scanDiskPath = async (path: string): Promise<TextSearchHit[]> => {
        if (getFileSize) {
            const size = await getFileSize(path)
            if (size !== null && size > maxFileBytes) return []
        }

        const content = await readFile(path)
        if (signal.aborted) return []
        if (content.length > maxFileBytes) return []

        return searchInContent(content, query, path, 'disk', maxHits)
    }

    const diskResult = await scanDiskPaths(diskPaths, concurrency, maxFilesScanned, maxHits - hits.length, scanDiskPath, signal)
    hits.push(...diskResult.hits)

    const hasMoreOnDisk = diskPaths.length > diskResult.filesScanned
    const capped = hits.length >= maxHits || hasMoreOnDisk
    return { hits: hits.slice(0, maxHits), capped }
}

export function textHitToPaletteItem(hit: TextSearchHit): import('@/components/studio/command-palette/types').TextPaletteItem {
    const name = getBaseName(hit.path)
    return {
        kind: 'text',
        value: `text:${hit.path}:${hit.line}:${hit.column}`,
        searchText: `${name} ${hit.preview} ${hit.path}`,
        path: hit.path,
        name,
        line: hit.line,
        column: hit.column,
        length: hit.length,
        preview: hit.preview,
        source: hit.source,
    }
}
