'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { Button } from '@/components/ui/button'
import { Card, CardPanel } from '@/components/ui/card'
import { DiagramIframe } from '@/lib/mermaid/svg-iframe'
import type { SvgContentBounds } from '@/lib/mermaid/svg-bounds'
import { cn } from '@/lib/utils'

const DIAGRAM_PADDING_X = 32

type EmbeddedMermaidBlockProps = {
    source: string
    blockId: string
    tabId: string | null
    onExpand: (blockId: string, source: string) => void
    className?: string
}

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none w-full select-none">
            <CardPanel className="p-3">
                <pre className="overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

export const EmbeddedMermaidBlock = memo(function EmbeddedMermaidBlock({ source, blockId, tabId, onExpand, className }: EmbeddedMermaidBlockProps) {
    const documentKey = tabId ? `${tabId}:block:${blockId}` : null
    const trimmed = source.trim()
    const { svgForDisplay, dimensions, error, isPending } = useMermaidSvg(source, documentKey)
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [contentBounds, setContentBounds] = useState<SvgContentBounds | null>(null)
    const displayedSvgRef = useRef<string | null>(null)

    useEffect(() => {
        if (!svgForDisplay) {
            displayedSvgRef.current = null
            setContentBounds(null)
            return
        }

        if (displayedSvgRef.current !== svgForDisplay) {
            displayedSvgRef.current = svgForDisplay
        }
    }, [svgForDisplay])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const update = () => setContainerWidth(el.clientWidth)
        update()

        const observer = new ResizeObserver(update)
        observer.observe(el)
        return () => observer.disconnect()
    }, [blockId])

    const onBoundsMeasured = useCallback((bounds: SvgContentBounds, measuredForSvg: string) => {
        if (measuredForSvg === displayedSvgRef.current) setContentBounds(bounds)
    }, [])

    const fitWidth = contentBounds?.width ?? dimensions?.width
    const fitHeight = contentBounds?.height ?? dimensions?.height
    const availableWidth = Math.max(0, containerWidth - DIAGRAM_PADDING_X)
    const scale = fitWidth && availableWidth > 0 ? Math.min(1, availableWidth / fitWidth) : 1
    const layoutWidth = fitWidth ? fitWidth * scale : undefined
    const layoutHeight = fitHeight ? fitHeight * scale : undefined

    const showDiagram = trimmed.length > 0 && Boolean(svgForDisplay) && !error && fitWidth != null && fitHeight != null
    const showPlaceholder = !showDiagram && ((isPending && trimmed.length > 0) || trimmed.length === 0)

    return (
        <div className={cn('relative my-4 w-full min-w-0', className)}>
            <div className="absolute top-2 right-2 z-10">
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="h-7 gap-1 shadow-sm"
                    disabled={!trimmed}
                    onClick={() => onExpand(blockId, source)}
                    aria-label="Expand diagram"
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
                style={showDiagram && layoutHeight != null ? { minHeight: layoutHeight + 32 } : undefined}
            >
                {error ? (
                    <div className="p-4">
                        <DiagramError message={error} />
                    </div>
                ) : showDiagram && layoutWidth != null && layoutHeight != null ? (
                    <div className="flex min-w-0 justify-center p-4">
                        <div className="relative shrink-0" style={{ width: layoutWidth, height: layoutHeight }}>
                            <div
                                className="absolute top-0 left-0 origin-top-left"
                                style={{
                                    width: fitWidth,
                                    height: fitHeight,
                                    transform: `scale(${scale})`,
                                }}
                            >
                                <DiagramIframe svg={svgForDisplay!} bounds={contentBounds} onBoundsMeasured={onBoundsMeasured} liveUpdate />
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
