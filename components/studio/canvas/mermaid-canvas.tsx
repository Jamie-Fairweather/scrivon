'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { useCanvasFitOnFirstView, useCanvasFitOnRequest } from '@/components/studio/canvas/use-canvas-fit-on-load'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { usePanZoom, type PanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import { useCanvasFit, useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { readDiagramAccessibility } from '@/lib/mermaid/accessibility'
import { pruneSvgCache } from '@/lib/mermaid/svg-cache'
import { DiagramIframe } from '@/lib/mermaid/svg-iframe'
import { CircleAlert, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardPanel } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type MermaidCanvasProps = {
    source: string
    className?: string
    /** Overrides active tab id for pan/zoom state and render cache (e.g. expanded md diagram). */
    canvasKey?: string
    /** Keeps each tab's pan and zoom while this canvas is unmounted (see usePanZoomMemory). */
    viewMemory?: PanZoomMemory
}

function stopCanvasGesture(event: React.SyntheticEvent) {
    event.stopPropagation()
}

/** Shown when there is no earlier diagram. The message can be selected, copied and scrolled. */
const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card
            role="status"
            className="pointer-events-auto w-full max-w-md cursor-auto select-text"
            data-canvas-no-gestures
            onPointerDown={stopCanvasGesture}
            onDoubleClick={stopCanvasGesture}
        >
            <CardPanel className="p-4">
                <pre className="max-h-[60vh] overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

/**
 * Shown over the last diagram that worked, outside the pan/zoom layer so the message can be read,
 * selected and scrolled. In a narrow canvas it keeps clear of the top-right corner, where the
 * expanded Markdown diagram has its Back button. A wide one has room to centre it past that.
 */
const DiagramErrorBanner = memo(function DiagramErrorBanner({ message }: { message: string }) {
    return (
        <div className="@container pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
            <div
                className="pointer-events-auto mr-21 w-full max-w-xl cursor-auto rounded-xl bg-background shadow-sm select-text @3xl:mr-0"
                data-canvas-no-gestures
                onPointerDown={stopCanvasGesture}
                onDoubleClick={stopCanvasGesture}
            >
                <Alert variant="error" role="status">
                    <CircleAlert aria-hidden />
                    <AlertTitle>Diagram has an error</AlertTitle>
                    <AlertDescription>
                        <pre className="max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap">{message}</pre>
                        <p className="text-xs">Showing the last version that worked.</p>
                    </AlertDescription>
                </Alert>
            </div>
        </div>
    )
})

const DiagramEmpty = memo(function DiagramEmpty({ message }: { message: string }) {
    return (
        <Card className="w-full max-w-md">
            <CardPanel className="p-4">
                <p className="text-center text-sm text-muted-foreground">{message}</p>
            </CardPanel>
        </Card>
    )
})

/** Fades in only if rendering takes a moment, so quick renders don't flash it. */
function DiagramLoading() {
    return (
        <p role="status" className="flex animate-in items-center gap-2 text-sm text-muted-foreground delay-300 fill-mode-backwards fade-in">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Rendering diagram…
        </p>
    )
}

export function MermaidCanvas({ source, className, canvasKey, viewMemory }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const dimensionsRef = useRef<{ width: number; height: number } | null>(null)

    const { activeTabId, tabs } = useDocumentTabs()
    const viewKey = canvasKey ?? activeTabId
    const { canvasFitRequestId } = useCanvasFit()
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    const tabName = tabs.find((t) => t.id === activeTabId)?.name
    // A diagram can name and describe itself with accTitle and accDescr; otherwise it's named after the tab.
    const accessibility = useMemo(() => readDiagramAccessibility(source), [source])
    const diagramLabel = accessibility.title ?? (tabName ? `Diagram: ${tabName}` : 'Diagram')
    const { reset, fitToView, hasViewStateForTab, handlers } = usePanZoom(containerRef, transformRef, viewKey, openTabIds, viewMemory)
    const { registerFitToView, setCanFitToView } = useCanvasControls()
    const hasSource = source.trim().length > 0
    const { svgForDisplay, dimensions, currentError: error, isPending, isEmpty } = useMermaidSvg(source, viewKey)

    useEffect(() => {
        pruneSvgCache(openTabIds)
    }, [openTabIds])

    useEffect(() => {
        dimensionsRef.current = dimensions
    }, [dimensions])

    useEffect(() => {
        setCanFitToView(Boolean(dimensions))
        return () => setCanFitToView(false)
    }, [dimensions, setCanFitToView])

    useEffect(() => {
        return registerFitToView(() => {
            const d = dimensionsRef.current
            if (d) fitToView(d.width, d.height)
        })
    }, [registerFitToView, fitToView])

    useCanvasFitOnRequest(canvasFitRequestId, dimensions, fitToView)
    useCanvasFitOnFirstView(dimensions, svgForDisplay, viewKey, hasViewStateForTab, fitToView)

    const emptyMessage = !viewKey
        ? 'Open a file to preview its diagram.'
        : isEmpty
          ? 'Nothing to draw yet. Add some nodes to see the diagram.'
          : 'Add Mermaid syntax to preview a diagram.'
    const showDiagram = hasSource && Boolean(svgForDisplay)
    const showEmpty = !error && !showDiagram && !isPending
    const showLoading = !error && !showDiagram && isPending

    return (
        <div
            ref={containerRef}
            className={cn('relative isolate min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background select-none', className)}
            onDoubleClick={reset}
            {...handlers}
        >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div ref={transformRef} className={cn('origin-center transition-opacity', showDiagram && error && 'opacity-40')}>
                    {showDiagram ? (
                        <DiagramIframe
                            key={viewKey ?? 'none'}
                            svg={svgForDisplay!}
                            label={diagramLabel}
                            description={accessibility.description ?? undefined}
                        />
                    ) : null}
                </div>
            </div>
            {/* Messages sit outside the pan/zoom layer, so they always show centred at full size. */}
            {!showDiagram && (error || showEmpty || showLoading) ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                    {error ? <DiagramError message={error} /> : showLoading ? <DiagramLoading /> : <DiagramEmpty message={emptyMessage} />}
                </div>
            ) : null}
            {showDiagram && error ? <DiagramErrorBanner message={error} /> : null}
        </div>
    )
}
