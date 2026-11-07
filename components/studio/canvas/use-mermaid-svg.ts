'use client'

import { useEffect, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagramAsync, SupersededRenderError } from '@/lib/mermaid/render-client'
import {
    forgetDocumentSvgs,
    isBeingEdited,
    readCachedSvg,
    readLatestSvg,
    readRenderError,
    readSvgForSource,
    startRender,
    storeRenderError,
    storeSvg,
    touchSvg,
} from '@/lib/mermaid/svg-cache'

/** Wait this long after a keystroke before rendering. A document shown for the first time renders straight away. */
const RENDER_DEBOUNCE_MS = 200

type DiagramDisplay = { trimmedSource: string; svg: string; documentKey: string; themeId: string }
type RenderError = { message: string; documentKey: string; themeId: string; trimmedSource: string }

export function useMermaidSvg(source: string, documentKey: string | null) {
    const { themeId } = useAppTheme()

    const trimmedSource = source.trim()
    const canRender = Boolean(trimmedSource && documentKey)

    const [display, setDisplay] = useState<DiagramDisplay | null>(null)
    const [error, setError] = useState<RenderError | null>(null)
    // Bumped when a render for text the user has since moved on from lands in the cache, so the
    // picture shown while the current text renders can move up to it.
    const [, setCacheVersion] = useState(0)

    useEffect(() => {
        // A cleared document starts over, so its old diagram can't come back once typing resumes.
        if (documentKey && !trimmedSource) forgetDocumentSvgs(documentKey)
    }, [documentKey, trimmedSource])

    useEffect(() => {
        if (!canRender || !documentKey) return
        // Already worked out, or already failed: both are read straight from the cache below.
        if (readCachedSvg(themeId, documentKey, trimmedSource) !== null || readRenderError(themeId, documentKey, trimmedSource) !== null) return
        // Another document drew this exact text (a Markdown block that moved has a new key): keep its picture.
        const shared = readSvgForSource(themeId, trimmedSource)
        if (shared !== null) {
            storeSvg(themeId, documentKey, trimmedSource, shared)
            return
        }

        // Cleared as soon as the text, theme or document changes, or the view goes away.
        let cancelled = false
        // Aborted at the same time, so a render that hasn't started is dropped rather than holding up other diagrams.
        const stillWanted = new AbortController()

        const showSvg = (svg: string) => {
            if (cancelled) return
            setDisplay({ trimmedSource, svg, documentKey, themeId })
            setError(null)
        }

        const showError = (message: string) => {
            if (cancelled) return
            setError({ message, documentKey, themeId, trimmedSource })
        }

        // Debounce typing, but don't make a newly opened document or a theme change wait.
        const delay = isBeingEdited(themeId, documentKey, trimmedSource) ? RENDER_DEBOUNCE_MS : 0
        const timer = window.setTimeout(() => {
            // Other views of the same document (the export menu, say) render the same text on the
            // same timer, so reuse what the first one worked out instead of laying it out again.
            const cachedSvg = readCachedSvg(themeId, documentKey, trimmedSource)
            const cachedError = readRenderError(themeId, documentKey, trimmedSource)
            if (cachedSvg !== null) {
                showSvg(cachedSvg)
                return
            }
            if (cachedError !== null) {
                showError(cachedError)
                return
            }
            // Another document drew this text while this one waited (the block under an expanded diagram, say).
            const shared = readSvgForSource(themeId, trimmedSource)
            if (shared !== null) {
                storeSvg(themeId, documentKey, trimmedSource, shared)
                showSvg(shared)
                return
            }

            // Layout runs in a worker, so a big diagram doesn't freeze typing. A result that started
            // is kept even when the text has moved on by the time it arrives: going back to that text
            // needs no second layout, and it is newer than the picture on screen. The cache drops it if
            // the document was cleared meanwhile, so a deleted diagram can't come back.
            const startedAt = startRender()
            renderMermaidDiagramAsync(trimmedSource, themeId, documentKey, stillWanted.signal).then(
                (svg) => {
                    const stored = storeSvg(themeId, documentKey, trimmedSource, svg, startedAt)
                    if (!cancelled) showSvg(svg)
                    else if (stored) setCacheVersion((version) => version + 1)
                },
                (err: unknown) => {
                    if (err instanceof SupersededRenderError) return
                    const message = err instanceof Error ? err.message : String(err)
                    storeRenderError(themeId, documentKey, trimmedSource, message, startedAt)
                    showError(message)
                }
            )
        }, delay)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
            stillWanted.abort()
        }
    }, [canRender, documentKey, themeId, trimmedSource])

    const hasDocument = canRender && documentKey !== null
    const displayIsCurrent = display?.documentKey === documentKey && display.themeId === themeId && display.trimmedSource === trimmedSource
    const currentSvg = hasDocument
        ? (readCachedSvg(themeId, documentKey, trimmedSource) ?? (displayIsCurrent ? display.svg : null) ?? readSvgForSource(themeId, trimmedSource))
        : null

    useEffect(() => {
        // Whatever the user is looking at (after an undo, or coming back to a tab) is what a later
        // typo falls back to, not whichever version happened to render last.
        if (currentSvg !== null && documentKey) touchSvg(themeId, documentKey, trimmedSource)
    }, [currentSvg, documentKey, themeId, trimmedSource])

    // Text with nothing to draw yet (just `graph TD`, say) renders a 0×0 picture. Say so, rather than
    // show a blank canvas or the old diagram.
    const isEmpty = Boolean(currentSvg && !getSvgDimensions(currentSvg))
    // A failure is read from the cache too, so coming back to broken text shows its error at once.
    const cachedError = hasDocument && !currentSvg ? readRenderError(themeId, documentKey, trimmedSource) : null
    const errorIsCurrent = error?.documentKey === documentKey && error.themeId === themeId && error.trimmedSource === trimmedSource && !currentSvg
    const currentError = cachedError ?? (errorIsCurrent ? error.message : null)
    // While the current text is still rendering or doesn't parse, keep showing the last diagram that
    // worked. Right after a theme change that is the old-theme picture, so the canvas never goes blank.
    const svgForDisplay = isEmpty ? null : (currentSvg ?? (hasDocument ? readLatestSvg(themeId, documentKey, trimmedSource) : null))
    /** True when svgForDisplay is an older render, not the current text. */
    const isStale = Boolean(svgForDisplay) && !currentSvg
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    const isPending = canRender && !currentError && !isEmpty && !svgForDisplay

    return {
        svgForDisplay,
        dimensions,
        /** Why the current text doesn't render, when there is no older diagram to show instead. */
        error: svgForDisplay ? null : currentError,
        /** Why the current text doesn't render, also while an older diagram is shown (see isStale). */
        currentError,
        isStale,
        isPending,
        isEmpty,
    }
}
