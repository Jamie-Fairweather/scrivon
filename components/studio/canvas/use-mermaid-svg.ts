'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagram } from '@/lib/mermaid/render'

const RENDER_DEBOUNCE_MS = 48

type DiagramDisplay = { source: string; svg: string; documentKey: string; themeId: string }
type RenderError = { message: string; documentKey: string }

function cacheKey(themeId: string, trimmedSource: string) {
    return `${themeId}\0${trimmedSource}`
}

export function useMermaidSvg(source: string, documentKey: string | null) {
    const { themeId } = useAppTheme()
    const svgCacheRef = useRef(new Map<string, string>())
    const documentKeyRef = useRef(documentKey)
    const sourceRef = useRef(source)
    const themeIdRef = useRef(themeId)

    useEffect(() => {
        documentKeyRef.current = documentKey
        sourceRef.current = source
        themeIdRef.current = themeId
    }, [documentKey, source, themeId])

    const [display, setDisplay] = useState<DiagramDisplay | null>(null)
    const [error, setError] = useState<RenderError | null>(null)

    const trimmedSource = source.trim()
    const canRender = Boolean(trimmedSource && documentKey)

    useEffect(() => {
        svgCacheRef.current.clear()
    }, [themeId])

    useEffect(() => {
        if (!canRender || !documentKey) return

        const key = cacheKey(themeId, trimmedSource)
        const cached = svgCacheRef.current.get(key)
        if (cached) {
            setDisplay({ source, svg: cached, documentKey, themeId })
            setError(null)
            return
        }

        setDisplay((prev) => (prev?.documentKey === documentKey && prev.themeId === themeId ? prev : null))

        const renderForKey = documentKey
        const renderSource = source
        const renderTrimmed = trimmedSource
        const renderThemeId = themeId
        let cancelled = false

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

                svgCacheRef.current.set(key, svg)
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
    }, [canRender, documentKey, source, trimmedSource, themeId])

    const hasRenderError = Boolean(error && documentKey && error.documentKey === documentKey)
    const errorMessage = hasRenderError && error ? error.message : null
    const svgForDisplay =
        canRender && display && documentKey && display.documentKey === documentKey && display.themeId === themeId && !hasRenderError
            ? display.svg
            : null
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    const isPending =
        canRender && !hasRenderError && (!display || display.documentKey !== documentKey || display.source !== source || display.themeId !== themeId)

    return { svgForDisplay, dimensions, error: errorMessage, isPending }
}
