'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { useCanvasControls } from '@/components/studio/canvas-controls-provider'
import { useCanvasFitOnFirstView, useCanvasFitOnRequest } from '@/components/studio/use-canvas-fit-on-load'
import { useMermaidSvg } from '@/components/studio/use-mermaid-svg'
import { usePanZoom } from '@/components/studio/use-pan-zoom'
import { useCanvasFit, useDocumentTabs } from '@/components/studio/workspace-provider'
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

    useCanvasFitOnRequest(canvasFitRequestId, activeTabId, source, dimensions, fitToView, lastHandledFitRequestRef)
    useCanvasFitOnFirstView(dimensions, svgForDisplay, activeTabId, hasViewStateForTab, fitToView)

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
