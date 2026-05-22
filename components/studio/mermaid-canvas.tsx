'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderMermaidSVG, THEMES, type RenderOptions } from 'beautiful-mermaid'
import { Card, CardPanel } from '@/components/ui/card'
import { useCanvasControls } from '@/components/studio/canvas-controls-provider'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { getSvgDimensions, usePanZoom } from '@/components/studio/use-pan-zoom'
import { cn } from '@/lib/utils'

type MermaidCanvasProps = {
    source: string
    className?: string
}

const RENDER_OPTIONS: RenderOptions = {
    ...THEMES['zinc-dark'],
    transparent: true,
}

function svgIframeDocument(svg: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:visible;vertical-align:top}
</style></head><body>${svg}</body></html>`
}

function scheduleIdleRender(run: () => void): () => void {
    if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(run, { timeout: 100 })
        return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => clearTimeout(id)
}

const DiagramIframe = memo(function DiagramIframe({ svg, width, height }: { svg: string; width: number; height: number }) {
    return (
        <iframe
            title="Diagram preview"
            className="pointer-events-none overflow-hidden border-0 bg-transparent"
            sandbox=""
            srcDoc={svgIframeDocument(svg)}
            style={{ width, height, background: 'transparent', colorScheme: 'normal', overflow: 'hidden' }}
        />
    )
})

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none max-w-md select-none">
            <CardPanel className="p-4">
                {/* <p className="mb-2 font-medium text-destructive">Diagram error</p> */}
                <pre className="overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

export function MermaidCanvas({ source, className }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const svgCacheRef = useRef(new Map<string, string>())
    const dimensionsRef = useRef<{ width: number; height: number } | null>(null)
    const renderedSourceRef = useRef(source)
    const lastHandledFitRequestRef = useRef(0)
    const { activeTabId, tabs, canvasFitRequestId } = useWorkspace()
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    const { reset, fitToView, hasViewStateForTab, handlers } = usePanZoom(containerRef, transformRef, activeTabId, openTabIds)
    const { registerFitToView, setCanFitToView } = useCanvasControls()

    const [displaySvg, setDisplaySvg] = useState<string | null>(() => svgCacheRef.current.get(source) ?? null)
    const [error, setError] = useState<string | null>(null)

    const svgForDisplay = svgCacheRef.current.get(source) ?? (displaySvg && renderedSourceRef.current === source ? displaySvg : null)

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
                const svg = renderMermaidSVG(source, RENDER_OPTIONS)
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

    const dimensions = svgForDisplay ? getSvgDimensions(svgForDisplay) : null
    dimensionsRef.current = dimensions

    useEffect(() => {
        setCanFitToView(Boolean(dimensions))
    }, [dimensions, setCanFitToView])

    useEffect(() => {
        return registerFitToView(() => {
            const d = dimensionsRef.current
            if (d) fitToView(d.width, d.height)
        })
    }, [registerFitToView, fitToView])

    useLayoutEffect(() => {
        if (canvasFitRequestId === 0 || canvasFitRequestId === lastHandledFitRequestRef.current) return
        if (!dimensions) return

        const fitRequest = { requestId: canvasFitRequestId, tabId: activeTabId, source }

        const attemptFit = () => {
            if (fitRequest.requestId !== canvasFitRequestId) return false
            if (fitRequest.tabId !== activeTabId || fitRequest.source !== source) return false
            return fitToView(dimensions.width, dimensions.height)
        }

        const markHandledIfFit = () => {
            if (attemptFit()) lastHandledFitRequestRef.current = canvasFitRequestId
        }

        if (markHandledIfFit()) return

        let innerId = 0
        const outerId = requestAnimationFrame(() => {
            if (markHandledIfFit()) return
            innerId = requestAnimationFrame(markHandledIfFit)
        })

        return () => {
            cancelAnimationFrame(outerId)
            if (innerId) cancelAnimationFrame(innerId)
        }
    }, [canvasFitRequestId, activeTabId, source, dimensions, fitToView])

    useLayoutEffect(() => {
        if (!dimensions || !svgForDisplay || !activeTabId) return
        if (hasViewStateForTab(activeTabId)) return

        const attemptFit = () => fitToView(dimensions.width, dimensions.height)
        if (attemptFit()) return

        let innerId = 0
        const outerId = requestAnimationFrame(() => {
            if (attemptFit()) return
            innerId = requestAnimationFrame(attemptFit)
        })

        return () => {
            cancelAnimationFrame(outerId)
            if (innerId) cancelAnimationFrame(innerId)
        }
    }, [dimensions, svgForDisplay, activeTabId, fitToView, hasViewStateForTab])

    return (
        <div
            ref={containerRef}
            className={cn('relative isolate min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background select-none', className)}
            onDoubleClick={reset}
            {...handlers}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                    backgroundImage: 'radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                }}
            />

            <div ref={transformRef} className="absolute top-0 left-0 origin-top-left">
                {error ? (
                    <DiagramError message={error} />
                ) : svgForDisplay && dimensions ? (
                    <DiagramIframe svg={svgForDisplay} width={dimensions.width} height={dimensions.height} />
                ) : null}
            </div>
        </div>
    )
}
