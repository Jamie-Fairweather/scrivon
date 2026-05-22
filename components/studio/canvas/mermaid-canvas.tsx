'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

export function MermaidCanvas({ source, className }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const dimensionsRef = useRef<{ width: number; height: number } | null>(null)
    const lastHandledFitRequestRef = useRef(0)

    const { activeTabId, tabs } = useDocumentTabs()
    const { canvasFitRequestId } = useCanvasFit()
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    const { reset, fitToView, hasViewStateForTab, handlers } = usePanZoom(containerRef, transformRef, activeTabId, openTabIds)
    const { registerFitToView, setCanFitToView } = useCanvasControls()
    const { svgForDisplay, dimensions, error } = useMermaidSvg(source)
    const [contentBounds, setContentBounds] = useState<SvgContentBounds | null>(null)

    const fitDimensions = contentBounds ?? dimensions

    useEffect(() => {
        setContentBounds(null)
    }, [svgForDisplay])

    const handleBoundsMeasured = useCallback((bounds: SvgContentBounds) => {
        setContentBounds(bounds)
    }, [])

    dimensionsRef.current = fitDimensions

    useEffect(() => {
        setCanFitToView(Boolean(fitDimensions))
    }, [fitDimensions, setCanFitToView])

    useEffect(() => {
        return registerFitToView(() => {
            const d = dimensionsRef.current
            if (d) fitToView(d.width, d.height)
        })
    }, [registerFitToView, fitToView])

    // Refit when tight measured bounds arrive (viewBox often includes extra margin).
    useLayoutEffect(() => {
        if (!contentBounds || !dimensions) return
        const viewBoxArea = dimensions.width * dimensions.height
        const boundsArea = contentBounds.width * contentBounds.height
        if (boundsArea >= viewBoxArea * 0.95) return
        fitToView(contentBounds.width, contentBounds.height)
    }, [contentBounds, dimensions, fitToView])

    useCanvasFitOnRequest(canvasFitRequestId, activeTabId, source, fitDimensions, fitToView, lastHandledFitRequestRef)
    useCanvasFitOnFirstView(fitDimensions, svgForDisplay, activeTabId, hasViewStateForTab, fitToView)

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

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div ref={transformRef} className="origin-center">
                    {error ? (
                        <DiagramError message={error} />
                    ) : svgForDisplay && dimensions ? (
                        <DiagramIframe
                            svg={svgForDisplay}
                            width={dimensions.width}
                            height={dimensions.height}
                            bounds={contentBounds}
                            onBoundsMeasured={handleBoundsMeasured}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    )
}
