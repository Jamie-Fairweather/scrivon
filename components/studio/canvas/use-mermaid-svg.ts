'use client'

import { useEffect, useRef, useState } from 'react'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { renderMermaidDiagram, scheduleIdleRender } from '@/lib/mermaid/render'

export function useMermaidSvg(source: string) {
    const svgCacheRef = useRef(new Map<string, string>())
    const renderedSourceRef = useRef(source)
    const [displaySvg, setDisplaySvg] = useState<string | null>(() => svgCacheRef.current.get(source) ?? null)
    const [error, setError] = useState<string | null>(null)

    const svgForDisplay = svgCacheRef.current.get(source) ?? (displaySvg && renderedSourceRef.current === source ? displaySvg : null)
    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null

    useEffect(() => {
        setError(null)

        const cached = svgCacheRef.current.get(source)
        if (cached) {
            renderedSourceRef.current = source
            setDisplaySvg(cached)
        } else {
            renderedSourceRef.current = source
            setDisplaySvg(null)
        }

        let cancelled = false
        const cancelIdle = scheduleIdleRender(() => {
            if (cancelled) return
            try {
                const svg = renderMermaidDiagram(source)
                if (cancelled) return
                svgCacheRef.current.set(source, svg)
                renderedSourceRef.current = source
                setDisplaySvg(svg)
                setError(null)
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
            }
        })

        return () => {
            cancelled = true
            cancelIdle()
        }
    }, [source])

    return { svgForDisplay, dimensions, error }
}
