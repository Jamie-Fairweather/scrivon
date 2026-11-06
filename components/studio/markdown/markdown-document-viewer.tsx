'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { clearFencedCodeBlockContainers } from '@/components/studio/markdown/fenced-code-block'
import { MarkdownPreview } from '@/components/studio/markdown/markdown-preview'
import { useFrameSyncedValue } from '@/components/studio/markdown/use-frame-synced-value'
import { useMarkdownExpand } from '@/components/studio/markdown/markdown-expand-context'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCanvasFit } from '@/components/studio/workspace/workspace-provider'
import { cn } from '@/lib/utils'

type MarkdownDocumentViewerProps = {
    source: string
    tabId: string | null
    className?: string
}

function scrollViewport(root: HTMLElement | null): HTMLElement | null {
    return root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
}

function MarkdownDocumentViewerInner({ source, tabId, className }: MarkdownDocumentViewerProps) {
    const previewSource = useFrameSyncedValue(source, tabId)
    const { expanded, setExpanded } = useMarkdownExpand()
    const { requestCanvasFit } = useCanvasFit()
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const expandedKey = expanded?.canvasKey ?? null
    /** Last preview scroll position per tab. The viewer stays mounted across tab switches, so it keeps them. */
    const scrollTopByTabRef = useRef(new Map<string, number>())
    /** Which tab scroll events belong to; recording pauses while a diagram is expanded over the preview. */
    const scrollTrackingRef = useRef<{ tabId: string | null; paused: boolean }>({ tabId, paused: false })
    const lastViewRef = useRef<{ tabId: string | null; expandedKey: string | null }>({ tabId, expandedKey: null })

    useEffect(() => {
        clearFencedCodeBlockContainers()
    }, [tabId])

    useEffect(() => {
        const viewport = scrollViewport(scrollAreaRef.current)
        if (!viewport) return

        const onScroll = () => {
            const { tabId: scrollTabId, paused } = scrollTrackingRef.current
            if (scrollTabId && !paused) scrollTopByTabRef.current.set(scrollTabId, viewport.scrollTop)
        }

        viewport.addEventListener('scroll', onScroll, { passive: true })
        return () => viewport.removeEventListener('scroll', onScroll)
    }, [])

    const onExpandBlock = useCallback(
        (blockId: string, blockSource: string) => {
            if (!tabId) return
            const viewport = scrollViewport(scrollAreaRef.current)
            if (viewport) scrollTopByTabRef.current.set(tabId, viewport.scrollTop)
            setExpanded({
                blockId,
                source: blockSource,
                canvasKey: `${tabId}:expanded:${blockId}`,
            })
        },
        [tabId, setExpanded]
    )

    const onCloseExpanded = useCallback(() => setExpanded(null), [setExpanded])

    useEffect(() => {
        if (!expandedKey) return

        requestCanvasFit()
        const outerId = requestAnimationFrame(() => {
            requestCanvasFit()
        })
        return () => cancelAnimationFrame(outerId)
    }, [expandedKey, requestCanvasFit])

    // Restores the preview scroll position after switching tabs or closing the expanded diagram.
    useLayoutEffect(() => {
        const previous = lastViewRef.current
        lastViewRef.current = { tabId, expandedKey }
        scrollTrackingRef.current = { tabId, paused: expandedKey !== null }
        if (expandedKey) return

        const tabChanged = previous.tabId !== tabId
        const closedExpanded = !tabChanged && previous.expandedKey !== null
        if (!tabChanged && !closedExpanded) return

        const scrollTop = (tabId ? scrollTopByTabRef.current.get(tabId) : undefined) ?? 0
        const viewport = scrollViewport(scrollAreaRef.current)
        if (!viewport) return
        if (viewport.scrollTop !== scrollTop) viewport.scrollTop = scrollTop

        // Diagrams and code blocks may still be laying out, so apply it again once they have.
        let innerId = 0
        const outerId = requestAnimationFrame(() => {
            innerId = requestAnimationFrame(() => {
                const nextViewport = scrollViewport(scrollAreaRef.current)
                if (nextViewport && nextViewport.scrollTop !== scrollTop) nextViewport.scrollTop = scrollTop
            })
        })

        return () => {
            cancelAnimationFrame(outerId)
            if (innerId) cancelAnimationFrame(innerId)
        }
    }, [tabId, expandedKey])

    return (
        <div className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background', className)}>
            <div ref={scrollAreaRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ScrollArea className="size-full min-h-0" scrollbarGutter>
                    <MarkdownPreview source={previewSource} tabId={tabId} onExpandBlock={onExpandBlock} />
                </ScrollArea>
            </div>
            {expanded ? (
                <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
                    <div className="absolute top-2 right-2 z-20">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 gap-1.5 shadow-sm"
                            onClick={onCloseExpanded}
                            aria-label="Back to document preview"
                            title="Back to preview"
                        >
                            <X className="size-4" />
                            Back
                        </Button>
                    </div>
                    <MermaidCanvas source={expanded.source} canvasKey={expanded.canvasKey} className="min-h-0 flex-1" />
                </div>
            ) : null}
        </div>
    )
}

export function MarkdownDocumentViewer(props: MarkdownDocumentViewerProps) {
    return <MarkdownDocumentViewerInner {...props} />
}
