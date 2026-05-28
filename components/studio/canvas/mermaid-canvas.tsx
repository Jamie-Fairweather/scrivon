'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { useCanvasFitOnFirstView, useCanvasFitOnRequest } from '@/components/studio/canvas/use-canvas-fit-on-load'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { usePanZoom } from '@/components/studio/canvas/use-pan-zoom'
import { useCanvasFit, useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import type { SvgContentBounds } from '@/lib/mermaid/svg-bounds'
import { DiagramIframe } from '@/lib/mermaid/svg-iframe'
import { Card, CardPanel } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type MermaidCanvasProps = {
    source: string
    className?: string
    /** Overrides active tab id for pan/zoom state and render cache (e.g. expanded md diagram). */
    canvasKey?: string
}

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none max-w-md select-none">
            <CardPanel className="p-4">
                <pre className="overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

const DiagramEmpty = memo(function DiagramEmpty({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none max-w-md select-none">
            <CardPanel className="p-4">
                <p className="text-center text-sm text-muted-foreground">{message}</p>
            </CardPanel>
        </Card>
    )
})

export function MermaidCanvas({ source, className, canvasKey }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const dimensionsRef = useRef<{ width: number; height: number } | null>(null)
    const lastHandledFitRequestRef = useRef(0)

    const { activeTabId, tabs } = useDocumentTabs()
    const viewKey = canvasKey ?? activeTabId
    const { canvasFitRequestId } = useCanvasFit()
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    const { reset, fitToView, hasViewStateForTab, handlers } = usePanZoom(containerRef, transformRef, viewKey, openTabIds)
    const { registerFitToView, setCanFitToView } = useCanvasControls()
    const hasSource = source.trim().length > 0
    const { svgForDisplay, dimensions, error, isPending } = useMermaidSvg(source, viewKey)
    const [contentBounds, setContentBounds] = useState<SvgContentBounds | null>(null)
    const [boundsForSvg, setBoundsForSvg] = useState<string | null>(null)

    const effectiveBounds = boundsForSvg === svgForDisplay ? contentBounds : null
    const fitDimensions = effectiveBounds ?? dimensions

    const handleBoundsMeasured = useCallback(
        (bounds: SvgContentBounds, measuredForSvg: string) => {
            if (measuredForSvg !== svgForDisplay) return
            setContentBounds(bounds)
            setBoundsForSvg(measuredForSvg)
        },
        [svgForDisplay]
    )

    useEffect(() => {
        queueMicrotask(() => {
            setContentBounds(null)
            setBoundsForSvg(null)
        })
    }, [viewKey, hasSource])

    useEffect(() => {
        dimensionsRef.current = fitDimensions
    }, [fitDimensions])

    useEffect(() => {
        setCanFitToView(Boolean(fitDimensions))
        return () => setCanFitToView(false)
    }, [fitDimensions, setCanFitToView])

    useEffect(() => {
        return registerFitToView(() => {
            const d = dimensionsRef.current
            if (d) fitToView(d.width, d.height)
        })
    }, [registerFitToView, fitToView])

    useCanvasFitOnRequest(canvasFitRequestId, viewKey, source, fitDimensions, fitToView, lastHandledFitRequestRef)
    useCanvasFitOnFirstView(fitDimensions, svgForDisplay, viewKey, hasViewStateForTab, fitToView)

    const emptyMessage = !viewKey ? 'Open a file to preview its diagram.' : 'Add Mermaid syntax to preview a diagram.'
    const showDiagram = hasSource && Boolean(svgForDisplay) && !error
    const showEmpty = !error && !showDiagram && !isPending

    return (
        <div
            ref={containerRef}
            className={cn('relative isolate min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background select-none', className)}
            onDoubleClick={reset}
            {...handlers}
        >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div ref={transformRef} className="origin-center">
                    {error ? (
                        <DiagramError message={error} />
                    ) : showDiagram ? (
                        <DiagramIframe
                            key={viewKey ?? 'none'}
                            svg={svgForDisplay!}
                            bounds={effectiveBounds}
                            onBoundsMeasured={handleBoundsMeasured}
                        />
                    ) : showEmpty ? (
                        <DiagramEmpty message={emptyMessage} />
                    ) : null}
                </div>
            </div>
        </div>
    )
}
