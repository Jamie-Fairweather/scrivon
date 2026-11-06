/**
 * Rendered diagram SVGs, kept per document (a tab, or a block inside one) so switching tabs or
 * remounting a block doesn't run layout again. Each document keeps only its last few renders, so
 * undo and redo still hit, and only the most recently rendered documents are kept.
 */

type CachedRender = { themeId: string; source: string; svg: string }
type CachedFailure = { themeId: string; source: string; message: string }

const RENDERS_PER_DOCUMENT = 3
const MAX_DOCUMENTS = 100

/** documentKey → renders, newest first. Map order runs from least to most recently written. */
const renders = new Map<string, CachedRender[]>()
/** documentKey → the last text that failed to render, so a second view of it doesn't try again. */
const failures = new Map<string, CachedFailure>()

function setRecent<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key)
    map.set(key, value)
    for (const oldest of map.keys()) {
        if (map.size <= MAX_DOCUMENTS) break
        map.delete(oldest)
    }
}

export function readCachedSvg(themeId: string, documentKey: string, trimmedSource: string): string | null {
    return renders.get(documentKey)?.find((render) => render.themeId === themeId && render.source === trimmedSource)?.svg ?? null
}

/** The newest render of a document in this theme, whatever its source was. */
export function readLatestSvg(themeId: string, documentKey: string): string | null {
    return renders.get(documentKey)?.find((render) => render.themeId === themeId)?.svg ?? null
}

export function storeSvg(themeId: string, documentKey: string, trimmedSource: string, svg: string): void {
    const older = (renders.get(documentKey) ?? []).filter((render) => render.themeId !== themeId || render.source !== trimmedSource)
    setRecent(renders, documentKey, [{ themeId, source: trimmedSource, svg }, ...older].slice(0, RENDERS_PER_DOCUMENT))
}

export function readRenderError(themeId: string, documentKey: string, trimmedSource: string): string | null {
    const failure = failures.get(documentKey)
    return failure?.themeId === themeId && failure.source === trimmedSource ? failure.message : null
}

export function storeRenderError(themeId: string, documentKey: string, trimmedSource: string, message: string): void {
    setRecent(failures, documentKey, { themeId, source: trimmedSource, message })
}

export function forgetDocumentSvgs(documentKey: string): void {
    renders.delete(documentKey)
    failures.delete(documentKey)
}

/** Drops renders for tabs that are no longer open. Block keys start with their tab id and a colon. */
export function pruneSvgCache(openTabIds: readonly string[]): void {
    const open = new Set(openTabIds)
    const isOpen = (key: string) => open.has(key) || openTabIds.some((tabId) => key.startsWith(`${tabId}:`))
    for (const key of renders.keys()) if (!isOpen(key)) renders.delete(key)
    for (const key of failures.keys()) if (!isOpen(key)) failures.delete(key)
}

export function clearSvgCache(): void {
    renders.clear()
    failures.clear()
}
