'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { Button } from '@/components/ui/button'
import { Card, CardPanel } from '@/components/ui/card'
import { DiagramIframe } from '@/lib/mermaid/svg-iframe'
import type { SvgContentBounds } from '@/lib/mermaid/svg-bounds'
import { cn } from '@/lib/utils'

const DIAGRAM_PADDING_X = 32
/** Top padding (pt-10) plus bottom padding (pb-4): the top strip keeps the Expand button off the diagram. */
const DIAGRAM_PADDING_Y = 56
const MAX_BOUNDS_CACHE_ENTRIES = 100

/**
 * Tight bounds measured for each SVG, so a diagram that mounts again (switching back to its tab) is laid out at
 * its measured size straight away, instead of at its padded size until its iframe loads and is measured again.
 */
const measuredBoundsBySvg = new Map<string, SvgContentBounds>()

function rememberMeasuredBounds(svg: string, bounds: SvgContentBounds): void {
    measuredBoundsBySvg.delete(svg)
    measuredBoundsBySvg.set(svg, bounds)
    if (measuredBoundsBySvg.size > MAX_BOUNDS_CACHE_ENTRIES) {
        const oldest = measuredBoundsBySvg.keys().next().value
        if (oldest !== undefined) measuredBoundsBySvg.delete(oldest)
    }
}

type EmbeddedMermaidBlockProps = {
    source: string
    blockId: string
    /** Position among the document's diagrams, from 0. Gives each Expand button its own name. */
    ordinal: number
    tabId: string | null
    onExpand: (blockId: string, ordinal: number, source: string) => void
    className?: string
}

/** "Expand diagram 2", plus the diagram's accTitle when it has one, so screen readers can tell the buttons apart. */
export function expandDiagramLabel(ordinal: number, source: string): string {
    const title = /^\s*accTitle\s*:\s*(.+?)\s*$/m.exec(source)?.[1]
    return title ? `Expand diagram ${ordinal + 1}: ${title}` : `Expand diagram ${ordinal + 1}`
}

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="w-full select-text">
            <CardPanel className="p-3">
                <pre className="overflow-auto text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

export const EmbeddedMermaidBlock = memo(function EmbeddedMermaidBlock({
    source,
    blockId,
    ordinal,
    tabId,
    onExpand,
    className,
}: EmbeddedMermaidBlockProps) {
    const documentKey = tabId ? `${tabId}:block:${blockId}` : null
    const trimmed = source.trim()
    const { svgForDisplay, dimensions, error, isPending } = useMermaidSvg(source, documentKey)
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [contentBounds, setContentBounds] = useState<SvgContentBounds | null>(null)
    const [boundsForSvg, setBoundsForSvg] = useState<string | null>(null)
    const displayedSvgRef = useRef<string | null>(null)

    useEffect(() => {
        if (!svgForDisplay) {
            displayedSvgRef.current = null
            setContentBounds(null)
            setBoundsForSvg(null)
            return
        }

        if (displayedSvgRef.current !== svgForDisplay) {
            displayedSvgRef.current = svgForDisplay
        }
    }, [svgForDisplay])

    // Measured before the browser paints, so a cached diagram's first frame is already scaled to fit.
    useLayoutEffect(() => {
        const el = containerRef.current
        if (!el) return

        const update = () => setContainerWidth(el.clientWidth)
        update()

        const observer = new ResizeObserver(update)
        observer.observe(el)
        return () => observer.disconnect()
    }, [blockId])

    const onBoundsMeasured = useCallback((bounds: SvgContentBounds, measuredForSvg: string) => {
        rememberMeasuredBounds(measuredForSvg, bounds)
        if (measuredForSvg === displayedSvgRef.current) {
            setContentBounds(bounds)
            setBoundsForSvg(measuredForSvg)
        }
    }, [])

    const effectiveBounds = boundsForSvg === svgForDisplay ? contentBounds : svgForDisplay ? (measuredBoundsBySvg.get(svgForDisplay) ?? null) : null
    const fitWidth = effectiveBounds?.width ?? dimensions?.width
    const fitHeight = effectiveBounds?.height ?? dimensions?.height
    const availableWidth = Math.max(0, containerWidth - DIAGRAM_PADDING_X)
    const scale = fitWidth && availableWidth > 0 ? Math.min(1, availableWidth / fitWidth) : 1
    const layoutWidth = fitWidth ? fitWidth * scale : undefined
    const layoutHeight = fitHeight ? fitHeight * scale : undefined

    const diagramReady = trimmed.length > 0 && Boolean(svgForDisplay) && !error && fitWidth != null && fitHeight != null
    // Without a width (not measured yet, or the preview is hidden) the diagram would draw at full size, so the
    // placeholder holds its place instead.
    const showDiagram = diagramReady && containerWidth > 0
    const showPlaceholder = !showDiagram && ((isPending && trimmed.length > 0) || trimmed.length === 0 || diagramReady)

    return (
        <div className={cn('relative my-4 w-full min-w-0', className)} data-mermaid-block-id={blockId}>
            <div className="absolute top-2 right-2 z-10">
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="h-7 gap-1 shadow-sm"
                    disabled={!trimmed}
                    onClick={() => onExpand(blockId, ordinal, source)}
                    aria-label={expandDiagramLabel(ordinal, source)}
                    title="Expand diagram"
                >
                    <Maximize2 className="size-3.5" />
                    Expand
                </Button>
            </div>
            <div
                ref={containerRef}
                className={cn(
                    'relative w-full min-w-0 overflow-hidden rounded-lg border border-border bg-muted/30',
                    showPlaceholder ? 'flex min-h-[120px] items-center justify-center' : ''
                )}
                style={showDiagram && layoutHeight != null ? { minHeight: layoutHeight + DIAGRAM_PADDING_Y } : undefined}
            >
                {error ? (
                    <div className="px-4 pt-10 pb-4">
                        <DiagramError message={error} />
                    </div>
                ) : showDiagram && layoutWidth != null && layoutHeight != null ? (
                    <div className="flex min-w-0 justify-center px-4 pt-10 pb-4">
                        <div className="relative shrink-0" style={{ width: layoutWidth, height: layoutHeight }}>
                            <div
                                className="absolute top-0 left-0 origin-top-left"
                                style={{
                                    width: fitWidth,
                                    height: fitHeight,
                                    transform: `scale(${scale})`,
                                }}
                            >
                                <DiagramIframe svg={svgForDisplay!} bounds={effectiveBounds} onBoundsMeasured={onBoundsMeasured} />
                            </div>
                        </div>
                    </div>
                ) : isPending ? (
                    <p className="text-xs text-muted-foreground">Rendering diagram…</p>
                ) : !trimmed ? (
                    <p className="text-xs text-muted-foreground">Empty Mermaid block</p>
                ) : null}
            </div>
        </div>
    )
})
