'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagram } from '@/lib/mermaid/render'

const RENDER_DEBOUNCE_MS = 200

type DiagramDisplay = { source: string; svg: string; documentKey: string; themeId: string }
type RenderError = { message: string; documentKey: string }

const globalSvgCache = new Map<string, string>()

function cacheKey(themeId: string, documentKey: string, trimmedSource: string) {
    return `${themeId}\0${documentKey}\0${trimmedSource}`
}

function readCachedSvg(themeId: string, documentKey: string, trimmedSource: string): string | null {
    return globalSvgCache.get(cacheKey(themeId, documentKey, trimmedSource)) ?? null
}

function readStaleSvg(themeId: string, documentKey: string): string | null {
    const prefix = `${themeId}\0${documentKey}\0`
    for (const [key, svg] of globalSvgCache) {
        if (key.startsWith(prefix)) return svg
    }
    return null
}

function resolveSvgForDisplay(
    themeId: string,
    documentKey: string,
    trimmedSource: string,
    display: DiagramDisplay | null,
    hasRenderError: boolean
): string | null {
    if (hasRenderError) return null

    const exact = readCachedSvg(themeId, documentKey, trimmedSource)
    if (exact) return exact

    if (display?.documentKey === documentKey && display.themeId === themeId) {
        return display.svg
    }

    return readStaleSvg(themeId, documentKey)
}

export function useMermaidSvg(source: string, documentKey: string | null) {
    const { themeId } = useAppTheme()
    const documentKeyRef = useRef(documentKey)
    const sourceRef = useRef(source)
    const themeIdRef = useRef(themeId)

    const trimmedSource = source.trim()
    const canRender = Boolean(trimmedSource && documentKey)

    const [display, setDisplay] = useState<DiagramDisplay | null>(null)
    const [error, setError] = useState<RenderError | null>(null)

    useEffect(() => {
        documentKeyRef.current = documentKey
        sourceRef.current = source
        themeIdRef.current = themeId
    }, [documentKey, source, themeId])

    useEffect(() => {
        globalSvgCache.clear()
    }, [themeId])

    useEffect(() => {
        if (!canRender || !documentKey) return
        if (readCachedSvg(themeId, documentKey, trimmedSource)) return

        let cancelled = false
        const renderForKey = documentKey
        const renderSource = source
        const renderTrimmed = trimmedSource
        const renderThemeId = themeId

        const timer = window.setTimeout(() => {
            if (cancelled) return
            if (documentKeyRef.current !== renderForKey) return
            if (themeIdRef.current !== renderThemeId) return

            try {
                const svg = renderMermaidDiagram(renderTrimmed, renderThemeId)
                if (cancelled) return
                if (documentKeyRef.current !== renderForKey) return
                if (sourceRef.current !== renderSource) return
                if (themeIdRef.current !== renderThemeId) return

                globalSvgCache.set(cacheKey(renderThemeId, renderForKey, renderTrimmed), svg)
                setDisplay({ source: renderSource, svg, documentKey: renderForKey, themeId: renderThemeId })
                setError(null)
            } catch (err) {
                if (cancelled) return
                if (documentKeyRef.current !== renderForKey) return
                if (sourceRef.current !== renderSource) return
                setError({
                    message: err instanceof Error ? err.message : String(err),
                    documentKey: renderForKey,
                })
            }
        }, RENDER_DEBOUNCE_MS)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [canRender, documentKey, source, themeId, trimmedSource])

    const hasRenderError = Boolean(error && documentKey && error.documentKey === documentKey)
    const errorMessage = hasRenderError && error ? error.message : null
    const svgForDisplay = canRender && documentKey ? resolveSvgForDisplay(themeId, documentKey, trimmedSource, display, hasRenderError) : null
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    const isPending = canRender && !hasRenderError && !svgForDisplay

    return { svgForDisplay, dimensions, error: errorMessage, isPending }
}
