'use client'

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Maximize2 } from 'lucide-react'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardPanel } from '@/components/ui/card'
import { readDiagramAccessibility } from '@/lib/mermaid/accessibility'
import { DiagramIframe } from '@/lib/mermaid/svg-iframe'
import { overlayButtonClassName } from '@/lib/ui/button-classes'
import { cn } from '@/lib/utils'

const DIAGRAM_PADDING_X = 32
/** Top padding (pt-10) plus bottom padding (pb-4): the top strip keeps the Expand button off the diagram. */
const DIAGRAM_PADDING_Y = 56

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
export function expandDiagramLabel(ordinal: number, title: string | null): string {
    return title ? `Expand diagram ${ordinal + 1}: ${title}` : `Expand diagram ${ordinal + 1}`
}

/**
 * The language of Scrivon's own words. The block sits inside the document, which is tagged with the document's
 * language, so screen readers that switch voice by language would read them in a Japanese or Arabic voice. Text
 * that also carries the document's words (an accTitle, say) keeps the document's language instead.
 */
const APP_LANG = 'en'

/** Shown when there is no earlier diagram. The message can be selected and copied. */
const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card role="status" className="w-full select-text">
            <CardPanel className="p-3">
                <pre className="overflow-auto text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

/** Shown under the last diagram that worked, which is dimmed, so the error isn't hidden behind an old picture. */
const StaleDiagramError = memo(function StaleDiagramError({ message }: { message: string }) {
    return (
        <div lang={APP_LANG} className="px-4 pb-4 select-text">
            <Alert variant="error" role="status">
                <CircleAlert aria-hidden />
                <AlertTitle>Diagram has an error</AlertTitle>
                <AlertDescription>
                    <pre className="max-h-32 overflow-auto font-mono text-xs wrap-anywhere whitespace-pre-wrap">{message}</pre>
                    <p className="text-xs">Showing the last version that worked.</p>
                </AlertDescription>
            </Alert>
        </div>
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
    const { svgForDisplay, dimensions, error, currentError, isStale, isPending, isEmpty } = useMermaidSvg(source, documentKey)
    const accessibility = useMemo(() => readDiagramAccessibility(source), [source])
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)

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

    const fitWidth = dimensions?.width
    const fitHeight = dimensions?.height
    const availableWidth = Math.max(0, containerWidth - DIAGRAM_PADDING_X)
    const scale = fitWidth && availableWidth > 0 ? Math.min(1, availableWidth / fitWidth) : 1
    const layoutWidth = fitWidth ? fitWidth * scale : undefined
    const layoutHeight = fitHeight ? fitHeight * scale : undefined

    // An older picture still draws while the current text doesn't parse, dimmed, with the error under it.
    const diagramReady = trimmed.length > 0 && Boolean(svgForDisplay) && fitWidth != null && fitHeight != null
    // Without a width (not measured yet, or the preview is hidden) the diagram would draw at full size, so the
    // placeholder holds its place instead.
    const showDiagram = diagramReady && containerWidth > 0
    const staleError = isStale && currentError ? currentError : null
    const showPlaceholder = !showDiagram && ((isPending && trimmed.length > 0) || trimmed.length === 0 || isEmpty || diagramReady)

    return (
        <div className={cn('relative my-4 w-full min-w-0', className)} data-mermaid-block-id={blockId}>
            {/* English, unless the button's name has the diagram's own accTitle in it. */}
            <div className="absolute top-2 right-2 z-10" lang={accessibility.title ? undefined : APP_LANG}>
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className={cn('h-7 gap-1', overlayButtonClassName)}
                    disabled={!trimmed}
                    onClick={() => onExpand(blockId, ordinal, source)}
                    aria-label={expandDiagramLabel(ordinal, accessibility.title)}
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
                    <div lang={APP_LANG} className="px-4 pt-10 pb-4">
                        <DiagramError message={error} />
                    </div>
                ) : showDiagram && layoutWidth != null && layoutHeight != null ? (
                    <>
                        <div className="flex min-w-0 justify-center px-4 pt-10 pb-4">
                            <div className="relative shrink-0" style={{ width: layoutWidth, height: layoutHeight }}>
                                <div
                                    className={cn('absolute top-0 left-0 origin-top-left transition-opacity', staleError && 'opacity-40')}
                                    style={{
                                        width: fitWidth,
                                        height: fitHeight,
                                        transform: `scale(${scale})`,
                                    }}
                                >
                                    <DiagramIframe
                                        svg={svgForDisplay!}
                                        label={accessibility.title ?? `Diagram ${ordinal + 1}`}
                                        description={accessibility.description ?? undefined}
                                        lang={accessibility.title || accessibility.description ? undefined : APP_LANG}
                                    />
                                </div>
                            </div>
                        </div>
                        {staleError ? <StaleDiagramError message={staleError} /> : null}
                    </>
                ) : isPending ? (
                    <p lang={APP_LANG} className="text-xs text-muted-foreground">
                        Rendering diagram…
                    </p>
                ) : !trimmed ? (
                    <p lang={APP_LANG} className="text-xs text-muted-foreground">
                        Empty Mermaid block
                    </p>
                ) : isEmpty ? (
                    <p lang={APP_LANG} className="px-4 text-center text-xs text-muted-foreground">
                        Nothing to draw yet. Add some nodes to see the diagram.
                    </p>
                ) : null}
            </div>
        </div>
    )
})
