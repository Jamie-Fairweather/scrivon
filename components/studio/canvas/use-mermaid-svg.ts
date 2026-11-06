'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { clearSvgCache, forgetDocumentSvgs, readCachedSvg, readLatestSvg, readRenderError, storeRenderError, storeSvg } from '@/lib/mermaid/svg-cache'

const RENDER_DEBOUNCE_MS = 200

type DiagramDisplay = { trimmedSource: string; svg: string; documentKey: string; themeId: string }
type RenderError = { message: string; documentKey: string; themeId: string; trimmedSource: string }

export function useMermaidSvg(source: string, documentKey: string | null) {
    const { themeId } = useAppTheme()
    const documentKeyRef = useRef(documentKey)
    const sourceRef = useRef(source)
    const themeIdRef = useRef(themeId)

    const trimmedSource = source.trim()
    const canRender = Boolean(trimmedSource && documentKey)

    const [display, setDisplay] = useState<DiagramDisplay | null>(null)
    const [error, setError] = useState<RenderError | null>(null)
    const prevThemeIdRef = useRef<string | null>(null)

    useEffect(() => {
        documentKeyRef.current = documentKey
        sourceRef.current = source
        themeIdRef.current = themeId
    }, [documentKey, source, themeId])

    useEffect(() => {
        const prevThemeId = prevThemeIdRef.current
        prevThemeIdRef.current = themeId
        if (prevThemeId != null && prevThemeId !== themeId) {
            clearSvgCache()
        }
    }, [themeId])

    useEffect(() => {
        // A cleared document starts over, so its old diagram can't come back once typing resumes.
        if (documentKey && !trimmedSource) forgetDocumentSvgs(documentKey)
    }, [documentKey, trimmedSource])

    useEffect(() => {
        if (!canRender || !documentKey) return
        if (readCachedSvg(themeId, documentKey, trimmedSource)) return

        let cancelled = false
        const renderForKey = documentKey
        const renderSource = source
        const renderTrimmed = trimmedSource
        const renderThemeId = themeId

        const isCurrent = () =>
            !cancelled && documentKeyRef.current === renderForKey && sourceRef.current === renderSource && themeIdRef.current === renderThemeId

        const showSvg = (svg: string) => {
            if (!isCurrent()) return
            setDisplay({ trimmedSource: renderTrimmed, svg, documentKey: renderForKey, themeId: renderThemeId })
            setError(null)
        }

        const showError = (message: string) => {
            if (!isCurrent()) return
            setError({ message, documentKey: renderForKey, themeId: renderThemeId, trimmedSource: renderTrimmed })
        }

        const timer = window.setTimeout(() => {
            if (!isCurrent()) return

            // Other views of the same document (the export menu, say) render the same text on the
            // same timer, so reuse what the first one worked out instead of laying it out again.
            const cachedSvg = readCachedSvg(renderThemeId, renderForKey, renderTrimmed)
            const cachedError = readRenderError(renderThemeId, renderForKey, renderTrimmed)
            if (cachedSvg) {
                showSvg(cachedSvg)
            } else if (cachedError !== null) {
                showError(cachedError)
            } else {
                try {
                    const svg = renderMermaidDiagram(renderTrimmed, renderThemeId)
                    storeSvg(renderThemeId, renderForKey, renderTrimmed, svg)
                    showSvg(svg)
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    storeRenderError(renderThemeId, renderForKey, renderTrimmed, message)
                    showError(message)
                }
            }
        }, RENDER_DEBOUNCE_MS)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [canRender, documentKey, source, themeId, trimmedSource])

    const displayIsCurrent = display?.documentKey === documentKey && display.themeId === themeId && display.trimmedSource === trimmedSource
    const currentSvg =
        canRender && documentKey ? (readCachedSvg(themeId, documentKey, trimmedSource) ?? (displayIsCurrent ? display.svg : null)) : null
    const hasRenderError = Boolean(
        error && documentKey && !currentSvg && error.documentKey === documentKey && error.themeId === themeId && error.trimmedSource === trimmedSource
    )
    // While the current text is still rendering or doesn't parse, keep showing the newest diagram that worked.
    const svgForDisplay = currentSvg ?? (canRender && documentKey ? readLatestSvg(themeId, documentKey) : null)
    const errorMessage = hasRenderError && error ? error.message : null
    /** True when svgForDisplay is an older render, not the current text. */
    const isStale = Boolean(svgForDisplay) && !currentSvg
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    const isPending = canRender && !hasRenderError && !svgForDisplay

    return { svgForDisplay, dimensions, error: errorMessage, isStale, isPending }
}
