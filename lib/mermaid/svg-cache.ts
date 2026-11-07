/**
 * Rendered diagram SVGs, kept per document (a tab, or a block inside one) so switching tabs or
 * remounting a block doesn't run layout again. Each document keeps only its last few renders, so
 * undo and redo still hit, and only the most recently used documents are kept.
 */

import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

/**
 * `drawable` is false for a render with nothing in it (a 0×0 picture, e.g. just `graph TD`).
 * `usedAt` is when the render was last asked for or shown; a document's renders are kept newest first by it.
 */
type CachedRender = { themeId: string; source: string; svg: string; drawable: boolean; usedAt: number }
type CachedFailure = { themeId: string; source: string; message: string }

const RENDERS_PER_DOCUMENT = 3
const MAX_DOCUMENTS = 100

/** documentKey → renders, newest first. Map order runs from least to most recently used. */
const renders = new Map<string, CachedRender[]>()
/** documentKey → the last text that failed to render, so a second view of it doesn't try again. */
const failures = new Map<string, CachedFailure>()

/** Counts up on every render started, render shown and document cleared, so they can be ordered. */
let clock = 0
/** documentKey → when it was last cleared. A render started before then is out of date. */
const clearedAt = new Map<string, number>()
/** When the whole cache was last cleared, or when a forgotten clear (see markCleared) happened. */
let allClearedAt = 0

function setRecent<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key)
    map.set(key, value)
    for (const oldest of map.keys()) {
        if (map.size <= MAX_DOCUMENTS) break
        map.delete(oldest)
    }
}

function lastClearedAt(documentKey: string): number {
    return Math.max(allClearedAt, clearedAt.get(documentKey) ?? 0)
}

function markCleared(documentKey: string): void {
    clearedAt.delete(documentKey)
    clearedAt.set(documentKey, ++clock)
    for (const [oldest, at] of clearedAt) {
        if (clearedAt.size <= MAX_DOCUMENTS) break
        // Losing track of an old clear may only ever make older renders look out of date, never newer ones.
        allClearedAt = Math.max(allClearedAt, at)
        clearedAt.delete(oldest)
    }
}

/**
 * Call when a render starts and pass the result to storeSvg or storeRenderError with it. A result
 * that arrives after the user moved on then counts from when it was asked for, so it doesn't jump
 * ahead of a version they went back to meanwhile. If the document was cleared since, it isn't kept.
 */
export function startRender(): number {
    return ++clock
}

export function readCachedSvg(themeId: string, documentKey: string, trimmedSource: string): string | null {
    return renders.get(documentKey)?.find((render) => render.themeId === themeId && render.source === trimmedSource)?.svg ?? null
}

/**
 * What to show while this text is still rendering or doesn't parse. First the same text in
 * another theme (right after a theme change), so the current diagram stays up. Otherwise the
 * render in this theme the user saw or asked for last, or failing that the newest in any theme.
 * Null when that render had nothing to draw, so a typo after an empty diagram doesn't bring back
 * an older picture.
 */
export function readLatestSvg(themeId: string, documentKey: string, trimmedSource: string): string | null {
    const list = renders.get(documentKey)
    if (!list?.length) return null
    const latest = list.find((render) => render.source === trimmedSource) ?? list.find((render) => render.themeId === themeId) ?? list[0]
    return latest.drawable ? latest.svg : null
}

/**
 * Whether this text is an edit, so rendering it should wait for typing to pause: the document
 * already rendered, or failed to, in this theme. Not when the text already rendered in another
 * theme: then the theme just changed, and the diagram should catch up straight away.
 */
export function isBeingEdited(themeId: string, documentKey: string, trimmedSource: string): boolean {
    const list = renders.get(documentKey) ?? []
    const failure = failures.get(documentKey)
    const isOtherTheme = (entry: { themeId: string; source: string } | undefined) => entry?.themeId !== themeId && entry?.source === trimmedSource
    if (list.some(isOtherTheme) || isOtherTheme(failure)) return false
    return list.some((render) => render.themeId === themeId) || failure?.themeId === themeId
}

/** Returns false, and keeps nothing, when the document was cleared after the render started. */
export function storeSvg(themeId: string, documentKey: string, trimmedSource: string, svg: string, startedAt = startRender()): boolean {
    if (startedAt <= lastClearedAt(documentKey)) return false
    const list = renders.get(documentKey) ?? []
    const same = list.find((render) => render.themeId === themeId && render.source === trimmedSource)
    const render = { themeId, source: trimmedSource, svg, drawable: getSvgDimensions(svg) !== null, usedAt: Math.max(startedAt, same?.usedAt ?? 0) }
    const kept = [render, ...list.filter((other) => other !== same)].sort((a, b) => b.usedAt - a.usedAt).slice(0, RENDERS_PER_DOCUMENT)
    setRecent(renders, documentKey, kept)
    return true
}

/** The user is looking at this render again (after undo, say): it becomes the one to fall back on. */
export function touchSvg(themeId: string, documentKey: string, trimmedSource: string): void {
    const list = renders.get(documentKey)
    const render = list?.find((entry) => entry.themeId === themeId && entry.source === trimmedSource)
    if (!list || !render) return
    setRecent(renders, documentKey, [{ ...render, usedAt: ++clock }, ...list.filter((entry) => entry !== render)])
}

export function readRenderError(themeId: string, documentKey: string, trimmedSource: string): string | null {
    const failure = failures.get(documentKey)
    return failure?.themeId === themeId && failure.source === trimmedSource ? failure.message : null
}

/** Returns false, and keeps nothing, when the document was cleared after the render started. */
export function storeRenderError(themeId: string, documentKey: string, trimmedSource: string, message: string, startedAt = startRender()): boolean {
    if (startedAt <= lastClearedAt(documentKey)) return false
    setRecent(failures, documentKey, { themeId, source: trimmedSource, message })
    return true
}

/** A cleared document starts over: its renders go, and renders still running for it aren't kept. */
export function forgetDocumentSvgs(documentKey: string): void {
    renders.delete(documentKey)
    failures.delete(documentKey)
    markCleared(documentKey)
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
    clearedAt.clear()
    allClearedAt = ++clock
}
