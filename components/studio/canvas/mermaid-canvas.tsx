'use client'

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { DiagramZoomToolbar } from '@/components/studio/canvas/diagram-zoom-toolbar'
import { useCanvasFitOnFirstView, useCanvasFitOnRequest } from '@/components/studio/canvas/use-canvas-fit-on-load'
import { useDiagramPicking, type LocateInFile } from '@/components/studio/canvas/use-diagram-picking'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { stopCanvasGesture, usePanZoom, type PanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import { useCanvasFit, useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { readDiagramAccessibility } from '@/lib/mermaid/accessibility'
import { diagramName } from '@/lib/mermaid/diagram-alt-text'
import { supportedDiagramsSentence } from '@/lib/mermaid/prepare-source'
import { diagramPartsKind } from '@/lib/mermaid/source-locations'
import { pruneSvgCache } from '@/lib/mermaid/svg-cache'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
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
    /**
     * Turns a place in the diagram's text into one in the host's file, so double-clicking a part selects it in the
     * editor. Without it, a double-click only resets the view.
     */
    locateInFile?: LocateInFile
    /** Whether `@` in the command palette lists this diagram's parts, so the screen reader hint can say so. */
    partsInPalette?: boolean
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

/** Shown under the empty message of an empty file. */
const DIAGRAM_TYPES_HINT =
    `Scrivon draws ${supportedDiagramsSentence()}. ` +
    'Press Ctrl+Space in the editor for a flowchart, sequence, class, state, entity relationship or XY chart starter.'

const DiagramEmpty = memo(function DiagramEmpty({ message, hint }: { message: string; hint?: string }) {
    return (
        <Card className="w-full max-w-md">
            <CardPanel className="flex flex-col gap-2 p-4 text-center text-sm text-muted-foreground">
                <p>{message}</p>
                {hint ? <p className="text-xs">{hint}</p> : null}
            </CardPanel>
        </Card>
    )
})

/**
 * The outline of the part a double-click would pick, drawn over the picture inside the pan and zoom layer so it
 * moves and scales with it, its line the same width at any zoom. Only shapes made here: never the diagram's own
 * markup. Hidden from screen readers and the pointer; the canvas finds the part itself (use-diagram-picking.ts).
 */
const DiagramPickLayer = memo(function DiagramPickLayer({ svg, outlineRef }: { svg: string; outlineRef: RefObject<SVGPathElement | null> }) {
    const size = getSvgDimensions(svg)
    if (!size) return null
    return (
        <svg
            aria-hidden
            focusable="false"
            className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
        >
            <path
                ref={outlineRef}
                data-slot="diagram-pick-outline"
                d=""
                fill="none"
                className="stroke-ring"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
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

/**
 * What the canvas's description tells screen readers: its keys, and how to get from a part to its text. It only
 * mentions what works now: double-clicking only while it would jump (useDiagramPicking's canJump), and parts at all
 * only in a diagram whose parts can be picked (a flowchart, state or sequence diagram).
 */
function keysHint({ canJump, partsInPalette, pickable }: { canJump: boolean; partsInPalette: boolean; pickable: boolean }): string {
    let hint = '+ and - zoom, 0 goes back to 100%, and the arrow keys move the diagram.'
    if (pickable && canJump) hint += ' Double-click a node, link or message to select its text in the editor.'
    if (pickable && partsInPalette) hint += " In the command palette, type @ to list the diagram's parts and pick one with the keyboard."
    return hint
}

export function MermaidCanvas({ source, className, canvasKey, viewMemory, locateInFile, partsInPalette = false }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const dimensionsRef = useRef<{ width: number; height: number } | null>(null)

    const { activeTabId, tabs } = useDocumentTabs()
    const viewKey = canvasKey ?? activeTabId
    const { canvasFitRequestId } = useCanvasFit()
    const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
    const tabName = tabs.find((t) => t.id === activeTabId)?.name
    // A diagram can name itself with accTitle or its own title (as in the exports' alt text), and describe itself with
    // accDescr; otherwise it's named for its kind and the tab: `Pie chart: pets.mmd`.
    const accessibility = useMemo(() => readDiagramAccessibility(source), [source])
    // diagramName, not diagramAltText: this runs on every edit, and only the name is needed, not the nodes.
    const diagramLabel = useMemo(() => {
        const { name, kind } = diagramName(source)
        if (name !== kind) return name
        return tabName ? `${kind}: ${tabName}` : kind
    }, [source, tabName])
    const { reset, zoom, zoomLevel, fitToView, hasViewStateForTab, getView, handlers } = usePanZoom(
        containerRef,
        transformRef,
        viewKey,
        openTabIds,
        viewMemory
    )
    const { registerFitToView, registerZoomDiagram, setCanFitToView } = useCanvasControls()
    const hasSource = source.trim().length > 0
    const { svgForDisplay, dimensions, currentError: error, isPending, isEmpty } = useMermaidSvg(source, viewKey)
    const keysHintId = useId()
    // The picture the frame shows, which lags svgForDisplay while a new one loads: parts are picked from this one.
    const [shownSvg, setShownSvg] = useState<string | null>(null)

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

    const fitDiagram = useCallback(() => {
        const d = dimensionsRef.current
        if (d) fitToView(d.width, d.height)
    }, [fitToView])

    useEffect(() => registerFitToView(fitDiagram), [registerFitToView, fitDiagram])
    useEffect(() => registerZoomDiagram(zoom), [registerZoomDiagram, zoom])

    useCanvasFitOnRequest(canvasFitRequestId, viewKey, dimensions, fitToView)
    useCanvasFitOnFirstView(dimensions, svgForDisplay, viewKey, hasViewStateForTab, fitToView)

    const emptyMessage = !viewKey
        ? 'Open a file to preview its diagram.'
        : isEmpty
          ? 'Nothing to draw yet. Add some nodes to see the diagram.'
          : 'Add Mermaid syntax to preview a diagram.'
    const emptyHint = viewKey && !isEmpty ? DIAGRAM_TYPES_HINT : undefined
    const showDiagram = hasSource && Boolean(svgForDisplay)
    const showEmpty = !error && !showDiagram && !isPending
    const showLoading = !error && !showDiagram && isPending
    const picking = useDiagramPicking({
        containerRef,
        getView,
        shownSvg: showDiagram ? shownSvg : null,
        source,
        locateInFile,
        panHandlers: handlers,
        reset,
    })
    const pickable = useMemo(() => diagramPartsKind(source) !== 'other', [source])

    return (
        <div
            ref={containerRef}
            role="group"
            aria-label="Diagram canvas"
            aria-describedby={showDiagram ? keysHintId : undefined}
            // A Tab stop only while there is a diagram to zoom; a click still focuses it.
            tabIndex={showDiagram ? 0 : -1}
            // F6 and Focus Preview come here (pane-focus.ts), so the zoom and arrow keys work straight away.
            data-pane-focus-self
            // Ctrl+wheel and the zoom keys here zoom the diagram, not the whole app (OWN_ZOOM_SELECTOR).
            data-own-zoom
            className={cn(
                'relative isolate min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background outline-none select-none',
                // The focus ring is drawn on top, so a zoomed-in diagram can't cover it.
                `after:pointer-events-none after:absolute after:inset-0 after:z-30 focus-visible:after:ring-2 focus-visible:after:ring-ring
                focus-visible:after:ring-inset`,
                className
            )}
            {...handlers}
            {...picking.handlers}
        >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div ref={transformRef} className={cn('relative origin-center transition-opacity', showDiagram && error && 'opacity-40')}>
                    {showDiagram ? (
                        <DiagramIframe
                            key={viewKey ?? 'none'}
                            svg={svgForDisplay!}
                            label={diagramLabel}
                            description={accessibility.description ?? undefined}
                            onShownSvg={setShownSvg}
                        />
                    ) : null}
                    {showDiagram && shownSvg && locateInFile ? <DiagramPickLayer svg={shownSvg} outlineRef={picking.outlineRef} /> : null}
                </div>
            </div>
            {/* Messages sit outside the pan/zoom layer, so they always show centred at full size. */}
            {!showDiagram && (error || showEmpty || showLoading) ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                    {error ? (
                        <DiagramError message={error} />
                    ) : showLoading ? (
                        <DiagramLoading />
                    ) : (
                        <DiagramEmpty message={emptyMessage} hint={emptyHint} />
                    )}
                </div>
            ) : null}
            {showDiagram && error ? <DiagramErrorBanner message={error} /> : null}
            {showDiagram ? (
                <>
                    <DiagramZoomToolbar zoomLevel={zoomLevel} onZoom={zoom} onFit={fitDiagram} />
                    <span id={keysHintId} hidden>
                        {keysHint({ canJump: picking.canJump, partsInPalette, pickable })}
                    </span>
                </>
            ) : null}
        </div>
    )
}
