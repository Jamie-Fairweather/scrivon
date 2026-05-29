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
    const previewSource = useFrameSyncedValue(source)
    const { expanded, setExpanded } = useMarkdownExpand()
    const { requestCanvasFit } = useCanvasFit()
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const savedScrollTopRef = useRef(0)

    useEffect(() => {
        clearFencedCodeBlockContainers()
    }, [tabId])

    const onExpandBlock = useCallback(
        (blockId: string, blockSource: string) => {
            if (!tabId) return
            const viewport = scrollViewport(scrollAreaRef.current)
            if (viewport) savedScrollTopRef.current = viewport.scrollTop
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
        if (!expanded) return

        requestCanvasFit()
        const outerId = requestAnimationFrame(() => {
            requestCanvasFit()
        })
        return () => cancelAnimationFrame(outerId)
    }, [expanded, requestCanvasFit])

    useLayoutEffect(() => {
        if (expanded) return

        const scrollTop = savedScrollTopRef.current
        const viewport = scrollViewport(scrollAreaRef.current)
        if (!viewport || viewport.scrollTop === scrollTop) return

        let innerId = 0
        const outerId = requestAnimationFrame(() => {
            innerId = requestAnimationFrame(() => {
                const nextViewport = scrollViewport(scrollAreaRef.current)
                if (nextViewport) nextViewport.scrollTop = scrollTop
            })
        })

        return () => {
            cancelAnimationFrame(outerId)
            if (innerId) cancelAnimationFrame(innerId)
        }
    }, [expanded])

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
