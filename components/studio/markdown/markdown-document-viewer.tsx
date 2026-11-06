'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { clearFencedCodeBlockContainers } from '@/components/studio/markdown/fenced-code-block'
import { resolveMarkdownLink } from '@/components/studio/markdown/markdown-links'
import { MarkdownPreview, mermaidBlockId } from '@/components/studio/markdown/markdown-preview'
import { extractMermaidBlockSources, locateMermaidBlock } from '@/components/studio/markdown/mermaid-block-sources'
import { useFrameSyncedValue } from '@/components/studio/markdown/use-frame-synced-value'
import { useMarkdownExpand } from '@/components/studio/markdown/markdown-expand-context'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCanvasFit, useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError, notifyInfo } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { isSupportedDocument } from '@/lib/workspace/file-types'
import { cn } from '@/lib/utils'

type MarkdownDocumentViewerProps = {
    source: string
    tabId: string | null
    className?: string
}

function scrollViewport(root: HTMLElement | null): HTMLElement | null {
    return root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
}

/** The heading or footnote a `#fragment` points at: an exact id match first, then one that differs only in case. */
function findAnchorTarget(root: HTMLElement | null, id: string): HTMLElement | null {
    if (!root) return null
    const lower = id.toLowerCase()
    let looseMatch: HTMLElement | null = null
    for (const element of root.querySelectorAll<HTMLElement>('[id]')) {
        if (element.id === id) return element
        if (!looseMatch && element.id.toLowerCase() === lower) looseMatch = element
    }
    return looseMatch
}

/** Same file, allowing for mixed `/` and `\` separators (and letter case on Windows). */
function isSamePath(a: string, b: string): boolean {
    if (a === b) return true
    const windows = /^[a-zA-Z]:|^\\\\/.test(a)
    const normalise = (path: string) => {
        const forward = path.replace(/\\/g, '/')
        return windows ? forward.toLowerCase() : forward
    }
    return normalise(a) === normalise(b)
}

/** The Expand button of a block, found again if the element that had focus was replaced. */
function findExpandButton(root: HTMLElement | null, blockId: string): HTMLElement | null {
    if (!root) return null
    for (const block of root.querySelectorAll<HTMLElement>('[data-mermaid-block-id]')) {
        if (block.dataset.mermaidBlockId === blockId) return block.querySelector<HTMLElement>('button')
    }
    return null
}

function MarkdownDocumentViewerInner({ source, tabId, className }: MarkdownDocumentViewerProps) {
    const previewSource = useFrameSyncedValue(source, tabId)
    const { expanded, setExpanded } = useMarkdownExpand()
    const { requestCanvasFit } = useCanvasFit()
    const { tabs, openFile } = useDocumentTabs()
    const { workspaceRoot } = useWorkspaceSession()
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const expandedKey = expanded?.canvasKey ?? null
    /** Last preview scroll position per tab. The viewer stays mounted across tab switches, so it keeps them. */
    const scrollTopByTabRef = useRef(new Map<string, number>())
    /** Which tab scroll events belong to; recording pauses while a diagram is expanded over the preview. */
    const scrollTrackingRef = useRef<{ tabId: string | null; paused: boolean }>({ tabId, paused: false })
    const lastViewRef = useRef<{ tabId: string | null; expandedKey: string | null }>({ tabId, expandedKey: null })
    /** A `#fragment` to scroll to once the linked document has opened. */
    const pendingAnchorRef = useRef<{ tabId: string; id: string } | null>(null)
    const linkHandlerRef = useRef<(href: string) => void>(() => {})
    const overlayRef = useRef<HTMLDivElement>(null)
    /** Where focus goes back to when the expanded diagram closes (normally the Expand button). */
    const returnFocusRef = useRef<{ blockId: string; element: HTMLElement | null } | null>(null)

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
        (blockId: string, ordinal: number, blockSource: string) => {
            if (!tabId) return
            const viewport = scrollViewport(scrollAreaRef.current)
            if (viewport) scrollTopByTabRef.current.set(tabId, viewport.scrollTop)
            const focused = document.activeElement
            const inPreview = focused instanceof HTMLElement && Boolean(scrollAreaRef.current?.contains(focused))
            returnFocusRef.current = { blockId, element: inPreview ? focused : null }
            setExpanded({
                blockId,
                ordinal,
                source: blockSource,
                canvasKey: `${tabId}:expanded:${blockId}`,
            })
        },
        [tabId, setExpanded]
    )

    const onCloseExpanded = useCallback(() => setExpanded(null), [setExpanded])

    const expandedOrdinal = expanded?.ordinal ?? null
    /** The document's Mermaid sources, only worked out while a diagram is expanded. */
    const liveMermaidSources = useMemo(
        () => (expandedOrdinal === null ? null : extractMermaidBlockSources(previewSource)),
        [expandedOrdinal, previewSource]
    )
    const mermaidCountRef = useRef<{ canvasKey: string; count: number } | null>(null)

    // Keeps the expanded diagram, and the export that reads it, in step with edits to its block in the document.
    useEffect(() => {
        if (!expanded || !liveMermaidSources) return
        const previous = mermaidCountRef.current
        const previousCount = previous?.canvasKey === expanded.canvasKey ? previous.count : null
        mermaidCountRef.current = { canvasKey: expanded.canvasKey, count: liveMermaidSources.length }

        const located = locateMermaidBlock(expanded, liveMermaidSources, previousCount)
        if (!located) {
            setExpanded(null)
            return
        }
        if (located.ordinal === expanded.ordinal && located.source === expanded.source) return

        const blockId = located.ordinal === expanded.ordinal ? expanded.blockId : mermaidBlockId(tabId, located.ordinal)
        if (blockId !== expanded.blockId && returnFocusRef.current) returnFocusRef.current = { blockId, element: null }
        setExpanded({ ...expanded, ordinal: located.ordinal, source: located.source, blockId })
    }, [expanded, liveMermaidSources, setExpanded, tabId])

    const onOverlayKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            onCloseExpanded()
        },
        [onCloseExpanded]
    )

    useEffect(() => {
        const scrollToAnchor = (id: string) => {
            const target = findAnchorTarget(scrollAreaRef.current, id)
            if (target) target.scrollIntoView({ block: 'start' })
            else notifyInfo("Couldn't find that section", { description: `#${id}` })
        }

        linkHandlerRef.current = (href) => {
            const tab = tabs.find((t) => t.id === tabId)
            const documentPath = tab && !isExampleTabId(tab.id) ? tab.path : null
            const target = resolveMarkdownLink(href, { documentPath, workspaceRoot })

            switch (target.kind) {
                case 'none':
                    return
                case 'anchor':
                    scrollToAnchor(target.id)
                    return
                case 'external':
                    if (!isTauri()) {
                        window.open(target.url, '_blank', 'noopener,noreferrer')
                        return
                    }
                    openUrl(target.url).catch((err: unknown) => notifyError("Couldn't open link", err))
                    return
                case 'file': {
                    if (documentPath && isSamePath(target.path, documentPath)) {
                        if (target.fragment) scrollToAnchor(target.fragment)
                        return
                    }
                    if (!isSupportedDocument(target.path)) {
                        revealItemInDir(target.path).catch((err: unknown) => notifyError("Couldn't show the linked file", err))
                        return
                    }
                    const openPath = tabs.find((t) => isSamePath(t.path, target.path))?.path ?? target.path
                    pendingAnchorRef.current = target.fragment ? { tabId: openPath, id: target.fragment } : null
                    void openFile(openPath)
                    return
                }
                case 'unresolved':
                    notifyInfo("Can't follow this link", { description: 'Links to other files only work in documents saved on disk.' })
                    return
                case 'unsupported':
                    notifyInfo("Can't open this link", { description: 'Scrivon can open web, email and file links.' })
            }
        }
    })

    const onLinkClick = useCallback((href: string) => linkHandlerRef.current(href), [])

    useEffect(() => {
        if (!expandedKey) return

        overlayRef.current?.querySelector<HTMLElement>('button')?.focus()
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

        const returnFocus = returnFocusRef.current
        returnFocusRef.current = null
        // Only when focus went down with the overlay; never pull it out of the editor or elsewhere.
        const focusLost = !document.activeElement || document.activeElement === document.body
        if (closedExpanded && returnFocus && focusLost) {
            const element = returnFocus.element?.isConnected ? returnFocus.element : findExpandButton(scrollAreaRef.current, returnFocus.blockId)
            element?.focus({ preventScroll: true })
        }

        if (tabChanged) {
            const pendingAnchor = pendingAnchorRef.current
            pendingAnchorRef.current = null
            const anchorTarget = pendingAnchor?.tabId === tabId ? findAnchorTarget(scrollAreaRef.current, pendingAnchor.id) : null
            if (anchorTarget) {
                anchorTarget.scrollIntoView({ block: 'start' })
                return
            }
        }

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
            <div ref={scrollAreaRef} className="flex min-h-0 min-w-0 flex-1 flex-col" inert={expanded ? true : undefined}>
                <ScrollArea className="size-full min-h-0" scrollbarGutter>
                    <MarkdownPreview source={previewSource} tabId={tabId} onExpandBlock={onExpandBlock} onLinkClick={onLinkClick} />
                </ScrollArea>
            </div>
            {expanded ? (
                <div
                    ref={overlayRef}
                    role="region"
                    aria-label="Expanded diagram"
                    tabIndex={-1}
                    onKeyDown={onOverlayKeyDown}
                    className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background outline-none"
                >
                    <div className="absolute top-2 right-2 z-20">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 gap-1.5 shadow-sm"
                            onClick={onCloseExpanded}
                            aria-label="Back to document preview"
                            title="Back to preview (Esc)"
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
