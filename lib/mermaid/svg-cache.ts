/**
 * Rendered diagram SVGs, kept per document (a tab, or a block inside one) so switching tabs or
 * remounting a block doesn't run layout again. Each document keeps only its last few renders, so
 * undo and redo still hit, and only the most recently rendered documents are kept.
 */

type CachedRender = { themeId: string; source: string; svg: string }

const RENDERS_PER_DOCUMENT = 3
const MAX_DOCUMENTS = 100

/** documentKey → renders, newest first. Map order runs from least to most recently written. */
const renders = new Map<string, CachedRender[]>()

export function readCachedSvg(themeId: string, documentKey: string, trimmedSource: string): string | null {
    return renders.get(documentKey)?.find((render) => render.themeId === themeId && render.source === trimmedSource)?.svg ?? null
}

/** The newest render of a document in this theme, whatever its source was. */
export function readLatestSvg(themeId: string, documentKey: string): string | null {
    return renders.get(documentKey)?.find((render) => render.themeId === themeId)?.svg ?? null
}

export function storeSvg(themeId: string, documentKey: string, trimmedSource: string, svg: string): void {
    const older = (renders.get(documentKey) ?? []).filter((render) => render.themeId !== themeId || render.source !== trimmedSource)
    renders.delete(documentKey)
    renders.set(documentKey, [{ themeId, source: trimmedSource, svg }, ...older].slice(0, RENDERS_PER_DOCUMENT))

    for (const key of renders.keys()) {
        if (renders.size <= MAX_DOCUMENTS) break
        renders.delete(key)
    }
}

export function forgetDocumentSvgs(documentKey: string): void {
    renders.delete(documentKey)
}

/** Drops renders for tabs that are no longer open. Block keys start with their tab id and a colon. */
export function pruneSvgCache(openTabIds: readonly string[]): void {
    const open = new Set(openTabIds)
    for (const key of renders.keys()) {
        if (open.has(key)) continue
        if (openTabIds.some((tabId) => key.startsWith(`${tabId}:`))) continue
        renders.delete(key)
    }
}

export function clearSvgCache(): void {
    renders.clear()
}
