/**
 * Rendered diagram SVGs, kept per document (a tab, or a block inside one) so switching tabs or
 * remounting a block doesn't run layout again. Each document keeps only its last few renders, so
 * undo and redo still hit, and only the most recently rendered documents are kept.
 */

import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

/** `drawable` is false for a render with nothing in it (a 0×0 picture, e.g. just `graph TD`). */
type CachedRender = { themeId: string; source: string; svg: string; drawable: boolean }
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

/**
 * The newest render of a document, whatever its source was, in this theme if there is one. Right
 * after a theme change there isn't, so the old-theme picture stays up until the new one is ready.
 * Null when that render had nothing to draw, so a typo after an empty diagram doesn't bring back
 * an older picture.
 */
export function readLatestSvg(themeId: string, documentKey: string): string | null {
    const list = renders.get(documentKey)
    const latest = list?.find((render) => render.themeId === themeId) ?? list?.[0]
    return latest?.drawable ? latest.svg : null
}

/** Whether the document already rendered, or failed to, in this theme: it is being edited, not shown for the first time. */
export function hasRenderedInTheme(themeId: string, documentKey: string): boolean {
    return Boolean(renders.get(documentKey)?.some((render) => render.themeId === themeId)) || failures.get(documentKey)?.themeId === themeId
}

export function storeSvg(themeId: string, documentKey: string, trimmedSource: string, svg: string): void {
    const older = (renders.get(documentKey) ?? []).filter((render) => render.themeId !== themeId || render.source !== trimmedSource)
    const drawable = getSvgDimensions(svg) !== null
    setRecent(renders, documentKey, [{ themeId, source: trimmedSource, svg, drawable }, ...older].slice(0, RENDERS_PER_DOCUMENT))
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
