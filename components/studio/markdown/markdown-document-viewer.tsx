'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ImageOff, X } from 'lucide-react'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { isPathInside, isSamePath, resolveMarkdownLink, workspaceFilePath } from '@/components/studio/markdown/markdown-links'
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

/**
 * Above this length one parse of the preview takes tens of milliseconds, too slow to repeat on every keystroke,
 * so the preview waits for a short pause in typing instead.
 */
const LARGE_PREVIEW_CHARS = 10_000
const LARGE_PREVIEW_DELAY_MS = 200

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

/** The Expand button of a block, found again if the element that had focus was replaced. */
function findExpandButton(root: HTMLElement | null, blockId: string): HTMLElement | null {
    if (!root) return null
    for (const block of root.querySelectorAll<HTMLElement>('[data-mermaid-block-id]')) {
        if (block.dataset.mermaidBlockId === blockId) return block.querySelector<HTMLElement>('button')
    }
    return null
}

function MarkdownDocumentViewerInner({ source, tabId, className }: MarkdownDocumentViewerProps) {
    const previewSource = useFrameSyncedValue(source, tabId, source.length > LARGE_PREVIEW_CHARS ? LARGE_PREVIEW_DELAY_MS : 0)
    const { expanded, setExpanded } = useMarkdownExpand()
    const { requestCanvasFit } = useCanvasFit()
    const { tabs, openFile } = useDocumentTabs()
    const { workspaceRoot, tree } = useWorkspaceSession()
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

    /** Documents whose web images the user chose to load. Remembered until the app closes. */
    const [remoteImageTabs, setRemoteImageTabs] = useState<ReadonlySet<string>>(() => new Set())
    const loadRemoteImages = tabId !== null && remoteImageTabs.has(tabId)
    /** How many blocked web images the preview shows now, so the notice offering to load them shows only then. */
    const [blockedImageCount, setBlockedImageCount] = useState(0)

    const onRemoteImageBlocked = useCallback(() => {
        setBlockedImageCount((count) => count + 1)
        return () => setBlockedImageCount((count) => count - 1)
    }, [])

    const onLoadRemoteImages = useCallback(() => {
        if (tabId) setRemoteImageTabs((tabs) => new Set(tabs).add(tabId))
    }, [tabId])

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
                    const reveal = () => {
                        revealItemInDir(target.path).catch((err: unknown) => notifyError("Couldn't show the linked file", err))
                    }
                    if (!isSupportedDocument(target.path)) {
                        reveal()
                        return
                    }
                    // The path its tab or the explorer already uses, so the file never ends up open in two tabs.
                    const openPath =
                        tabs.find((t) => isSamePath(t.path, target.path))?.path ??
                        (workspaceRoot && isPathInside(target.path, workspaceRoot) ? workspaceFilePath(target.path, workspaceRoot, tree) : null)
                    if (!openPath) {
                        // Scrivon can only read files in the open folder, so opening it would fail with a vague error.
                        notifyInfo('That file is outside the open folder', {
                            description: 'Scrivon can only open files inside the folder you have open.',
                            action: { label: 'Show in folder', onClick: reveal },
                        })
                        return
                    }
                    pendingAnchorRef.current = target.fragment ? { tabId: openPath, id: target.fragment } : null
                    void openFile(openPath)
                    return
                }
                case 'network':
                    notifyInfo("Network links aren't opened", { description: "Scrivon doesn't follow links to files on other computers." })
                    return
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
                {blockedImageCount > 0 ? (
                    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                        <ImageOff className="size-3.5 shrink-0" aria-hidden />
                        <p className="min-w-0 flex-1">Images from the web are blocked to protect your privacy.</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={onLoadRemoteImages}
                            title="Load this document's web images until Scrivon closes. Their sites can see when you open it."
                        >
                            Load images
                        </Button>
                    </div>
                ) : null}
                <ScrollArea className="min-h-0 w-full flex-1" scrollbarGutter>
                    <MarkdownPreview
                        source={previewSource}
                        tabId={tabId}
                        onExpandBlock={onExpandBlock}
                        onLinkClick={onLinkClick}
                        loadRemoteImages={loadRemoteImages}
                        onRemoteImageBlocked={onRemoteImageBlocked}
                    />
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
