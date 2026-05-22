'use client'

import { useEffect, useRef, useState } from 'react'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagram } from '@/lib/mermaid/render'

const RENDER_DEBOUNCE_MS = 48

type DiagramDisplay = { source: string; svg: string; documentKey: string }
type RenderError = { message: string; documentKey: string }

export function useMermaidSvg(source: string, documentKey: string | null) {
    const svgCacheRef = useRef(new Map<string, string>())
    const documentKeyRef = useRef(documentKey)
    const sourceRef = useRef(source)
    documentKeyRef.current = documentKey
    sourceRef.current = source

    const [display, setDisplay] = useState<DiagramDisplay | null>(null)
    const [error, setError] = useState<RenderError | null>(null)

    const hasRenderError = Boolean(error && documentKey && error.documentKey === documentKey)
    const errorMessage = hasRenderError && error ? error.message : null
    const svgForDisplay = display && documentKey && display.documentKey === documentKey && !hasRenderError ? display.svg : null
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    const isPending =
        Boolean(source.trim() && documentKey) && !hasRenderError && (!display || display.documentKey !== documentKey || display.source !== source)

    useEffect(() => {
        const trimmedSource = source.trim()
        if (!trimmedSource || !documentKey) {
            setDisplay(null)
            setError(null)
            return
        }

        const cached = svgCacheRef.current.get(trimmedSource)
        if (cached) {
            setDisplay({ source, svg: cached, documentKey })
            setError(null)
            return
        }

        setDisplay((prev) => (prev?.documentKey === documentKey ? prev : null))

        const renderForKey = documentKey
        const renderSource = source
        const renderTrimmed = trimmedSource
        let cancelled = false

        const timer = window.setTimeout(() => {
            if (cancelled) return
            if (documentKeyRef.current !== renderForKey) return

            try {
                const svg = renderMermaidDiagram(renderTrimmed)
                if (cancelled) return
                if (documentKeyRef.current !== renderForKey) return
                if (sourceRef.current !== renderSource) return

                svgCacheRef.current.set(renderTrimmed, svg)
                setDisplay({ source: renderSource, svg, documentKey: renderForKey })
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
    }, [source, documentKey])

    return { svgForDisplay, dimensions, error: errorMessage, isPending }
}
