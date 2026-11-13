'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ImageOff, X } from 'lucide-react'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { lastMermaidBlockSources } from '@/components/studio/markdown/markdown-block-ordinals'
import { anchorKey, isPathInside, isSamePath, resolveMarkdownLink, workspaceFilePath } from '@/components/studio/markdown/markdown-links'
import { MarkdownPreview } from '@/components/studio/markdown/markdown-preview'
import { markdownPreviewBody } from '@/components/studio/markdown/markdown-preview-body'
import { locateMermaidBlock } from '@/components/studio/markdown/mermaid-block-sources'
import { registerPreviewHeadingReveal } from '@/components/studio/markdown/preview-heading'
import { useFrameSyncedValue } from '@/components/studio/markdown/use-frame-synced-value'
import { useMarkdownExpand, useMarkdownPreviewMemory } from '@/components/studio/markdown/markdown-expand-context'
import { PaneCrashNotice, PaneErrorBoundary } from '@/components/studio/shell/pane-error-boundary'
import { Button } from '@/components/ui/button'
import { Card, CardPanel } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCanvasFit, useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError, notifyInfo } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { overlayButtonClassName } from '@/lib/ui/button-classes'
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

/** The prefix the preview's sanitizer gives every id in the document, as GitHub does (see previewSanitizeSchema). */
const DOCUMENT_ID_PREFIX = 'user-content-'

/**
 * An element's id as the document wrote it, without the preview's prefix. For an old-style `<a name="install">`
 * anchor with no id, its name, which the sanitizer prefixes the same way.
 */
function documentId(element: HTMLElement): string {
    const id = element.id || element.getAttribute('name') || ''
    return id.startsWith(DOCUMENT_ID_PREFIX) ? id.slice(DOCUMENT_ID_PREFIX.length) : id
}

/**
 * The heading, footnote or `<a name>` anchor a `#fragment` points at: an exact id match first (with or without the
 * preview's `user-content-` prefix), then one that differs only in case, then one that matches once both are
 * reduced to export's id rules (GitHub-style links such as `#foo--bar`).
 */
function findAnchorTarget(root: HTMLElement | null, id: string): HTMLElement | null {
    if (!root) return null
    const lower = id.toLowerCase()
    const key = anchorKey(id)
    let exactMatch: HTMLElement | null = null
    let caseMatch: HTMLElement | null = null
    let keyMatch: HTMLElement | null = null
    for (const element of root.querySelectorAll<HTMLElement>('[id], a[name]')) {
        if (element.id && element.id === id) return element
        const written = documentId(element)
        if (!written) continue
        if (!exactMatch && written === id) exactMatch = element
        if (!caseMatch && written.toLowerCase() === lower) caseMatch = element
        if (!keyMatch && key && anchorKey(written) === key) keyMatch = element
    }
    return exactMatch ?? caseMatch ?? keyMatch
}

/**
 * Moves focus to the section a link led to, as following a link in a browser moves where Tab carries on from, so
 * the next Tab goes into that section and a screen reader reads it. A heading, footnote or `<a name>` anchor can't
 * normally take focus, so it can until focus moves on from it.
 */
function focusAnchorTarget(target: HTMLElement): void {
    // Tried first, as only the browser knows what can take focus (an `<a>` with no link can't, whatever its tabIndex).
    target.focus({ preventScroll: true })
    if (document.activeElement === target || target.hasAttribute('tabindex')) return

    target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    if (document.activeElement !== target) {
        target.removeAttribute('tabindex')
        return
    }
    const onBlur = () => {
        // Switching to another window blurs it but leaves it focused in the page, so it has focus again on return.
        if (document.activeElement === target) return
        target.removeEventListener('blur', onBlur)
        target.removeAttribute('tabindex')
    }
    target.addEventListener('blur', onBlur)
}

/**
 * Whether a `#fragment` that nothing in the document has means its top, as in a browser: `#top` in any letter case,
 * as in a README's `[Back to top](#top)`.
 */
function isTopOfDocument(id: string): boolean {
    return id.toLowerCase() === 'top'
}

/** How long a linked section is held at the top of the preview while the diagrams above it are drawn. */
const ANCHOR_SETTLE_MS = 1500
/** What the user does to scroll the preview themselves, which ends that hold. */
const USER_SCROLL_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/**
 * Scrolls a document that has just opened to its `#fragment`, then again each time its content changes size for a
 * moment after, as the diagrams above the section grow from placeholders into pictures. The user scrolling ends
 * it early. Returns the function that ends it.
 */
function holdAnchorInView(root: HTMLElement, id: string): () => void {
    const scrollToAnchor = () => findAnchorTarget(root, id)?.scrollIntoView({ block: 'start' })
    scrollToAnchor()
    const content = scrollViewport(root)?.firstElementChild
    if (!content || typeof ResizeObserver === 'undefined') return () => {}

    const observer = new ResizeObserver(scrollToAnchor)
    const timer = setTimeout(stop, ANCHOR_SETTLE_MS)
    function stop() {
        observer.disconnect()
        clearTimeout(timer)
        for (const type of USER_SCROLL_EVENTS) root.removeEventListener(type, stop)
    }
    for (const type of USER_SCROLL_EVENTS) root.addEventListener(type, stop, { passive: true })
    observer.observe(content)
    return stop
}

/** The Expand button of a block, found again if the element that had focus was replaced. */
function findExpandButton(root: HTMLElement | null, blockId: string): HTMLElement | null {
    if (!root) return null
    for (const block of root.querySelectorAll<HTMLElement>('[data-mermaid-block-id]')) {
        if (block.dataset.mermaidBlockId === blockId) return block.querySelector<HTMLElement>('button')
    }
    return null
}

/** What the preview shows while the document has nothing to show yet, like the diagram canvas's empty state. */
function PreviewEmpty() {
    return (
        <div className="flex min-h-full items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardPanel className="p-4">
                    <p className="text-center text-sm text-muted-foreground">Start writing Markdown to see a preview.</p>
                </CardPanel>
            </Card>
        </div>
    )
}

function previewCrashNotice(error: Error) {
    return <PaneCrashNotice title="Couldn't show the preview" error={error} hint="Edit the document to try again." />
}

function MarkdownDocumentViewerInner({ source, tabId, className }: MarkdownDocumentViewerProps) {
    const previewSource = useFrameSyncedValue(source, tabId, source.length > LARGE_PREVIEW_CHARS ? LARGE_PREVIEW_DELAY_MS : 0)
    const { expanded, setExpanded } = useMarkdownExpand()
    const { requestCanvasFit } = useCanvasFit()
    const { tabs, openFile } = useDocumentTabs()
    const { workspaceRoot, tree } = useWorkspaceSession()
    const tab = tabs.find((t) => t.id === tabId)
    /** The document's file, which its links and images are found from; an example has none. */
    const documentPath = tab && !isExampleTabId(tab.id) ? tab.path : null
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const expandedKey = expanded?.canvasKey ?? null
    /** Kept by the provider, so they survive this viewer unmounting while a diagram tab is open. */
    const { scrollTopByTab, remoteImageTabs, allowRemoteImages } = useMarkdownPreviewMemory()
    /** Which tab scroll events belong to; recording pauses while a diagram is expanded over the preview. */
    const scrollTrackingRef = useRef<{ tabId: string | null; paused: boolean }>({ tabId, paused: false })
    /** What the preview last showed; `undefined` before its first frame, so that frame restores the tab's place. */
    const lastViewRef = useRef<{ tabId: string | null | undefined; expandedKey: string | null }>({ tabId: undefined, expandedKey: null })
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
            if (scrollTabId && !paused) scrollTopByTab.set(scrollTabId, viewport.scrollTop)
        }

        viewport.addEventListener('scroll', onScroll, { passive: true })
        return () => viewport.removeEventListener('scroll', onScroll)
    }, [scrollTopByTab])

    // Forgets the place of tabs that were closed, so a document opened again starts at the top.
    useEffect(() => {
        for (const id of scrollTopByTab.keys()) {
            if (!tabs.some((tab) => tab.id === id)) scrollTopByTab.delete(id)
        }
    }, [tabs, scrollTopByTab])

    const onExpandBlock = useCallback(
        (blockId: string, ordinal: number, blockSource: string) => {
            if (!tabId) return
            const viewport = scrollViewport(scrollAreaRef.current)
            if (viewport) scrollTopByTab.set(tabId, viewport.scrollTop)
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
        [tabId, setExpanded, scrollTopByTab]
    )

    const onCloseExpanded = useCallback(() => setExpanded(null), [setExpanded])

    const loadRemoteImages = tabId !== null && remoteImageTabs.has(tabId)
    /** How many blocked web images the preview shows now, so the notice offering to load them shows only then. */
    const [blockedImageCount, setBlockedImageCount] = useState(0)

    const onRemoteImageBlocked = useCallback(() => {
        setBlockedImageCount((count) => count + 1)
        return () => setBlockedImageCount((count) => count - 1)
    }, [])

    const onLoadRemoteImages = useCallback(() => {
        if (tabId) allowRemoteImages(tabId)
    }, [tabId, allowRemoteImages])

    /** Nothing but spaces, or only front matter, which the preview leaves out. */
    const previewIsEmpty = useMemo(() => markdownPreviewBody(previewSource).trim() === '', [previewSource])
    const mermaidCountRef = useRef<{ canvasKey: string; count: number } | null>(null)

    // Keeps the expanded diagram, and the export that reads it, in step with edits to its block in the document.
    // Runs after the preview below the overlay has rendered this text, and reads the diagrams it found, so the
    // document isn't parsed a second time on each edit.
    useEffect(() => {
        if (!expanded) return
        const sources = previewIsEmpty ? [] : (lastMermaidBlockSources(tabId ?? '') ?? [])
        const previous = mermaidCountRef.current
        const previousCount = previous?.canvasKey === expanded.canvasKey ? previous.count : null
        mermaidCountRef.current = { canvasKey: expanded.canvasKey, count: sources.length }

        const located = locateMermaidBlock(expanded, sources, previousCount)
        if (!located) {
            setExpanded(null)
            return
        }
        if (located.ordinal === expanded.ordinal && located.source === expanded.source) return

        // The block id (and the canvas key made from it) stays: the preview's ids move with their blocks, so the
        // Expand button to return focus to, and the expanded view's pan and zoom, still belong to this block.
        setExpanded({ ...expanded, ordinal: located.ordinal, source: located.source })
    }, [expanded, previewSource, previewIsEmpty, tabId, setExpanded])

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
            if (target) {
                target.scrollIntoView({ block: 'start' })
                focusAnchorTarget(target)
                return
            }
            const viewport = isTopOfDocument(id) ? scrollViewport(scrollAreaRef.current) : null
            if (viewport) viewport.scrollTop = 0
            else notifyInfo("Couldn't find that section", { description: `#${id}` })
        }

        linkHandlerRef.current = (href) => {
            const target = resolveMarkdownLink(href, { documentPath, workspaceRoot })

            switch (target.kind) {
                case 'none':
                    return
                case 'top': {
                    const viewport = scrollViewport(scrollAreaRef.current)
                    if (viewport) viewport.scrollTop = 0
                    return
                }
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

    // The Outline panel moves the preview to a heading. Focus stays where it is (the panel moves it to the editor).
    useEffect(
        () =>
            registerPreviewHeadingReveal((id) => {
                const target = findAnchorTarget(scrollAreaRef.current, id)
                if (!target) return
                target.scrollIntoView({ block: 'start' })
                if (!expandedKey || !tabId) return
                // An expanded diagram covers the preview, so it closes. Closing it puts back the place the preview
                // had, so that becomes the heading's place.
                const viewport = scrollViewport(scrollAreaRef.current)
                if (viewport) scrollTopByTab.set(tabId, viewport.scrollTop)
                setExpanded(null)
            }),
        [expandedKey, tabId, scrollTopByTab, setExpanded]
    )

    useEffect(() => {
        if (!expandedKey) return

        overlayRef.current?.querySelector<HTMLElement>('button')?.focus()
        requestCanvasFit()
        const outerId = requestAnimationFrame(() => {
            requestCanvasFit()
        })
        return () => cancelAnimationFrame(outerId)
    }, [expandedKey, requestCanvasFit])

    // Restores the preview scroll position when it first shows, after switching tabs, and after closing the
    // expanded diagram.
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
            const root = scrollAreaRef.current
            // The same file however its path is written: openFile tidies the path it was given into the tab's id.
            const opened = pendingAnchor && tabId && isSamePath(pendingAnchor.tabId, tabId) ? pendingAnchor : null
            const anchorTarget = root && opened ? findAnchorTarget(root, opened.id) : null
            if (root && opened && anchorTarget) {
                // Held there while the diagrams above it are drawn, which would push it down or out of view.
                const stopHolding = holdAnchorInView(root, opened.id)
                // Only when focus went down with the link that was followed, or is still in the preview; never pull
                // it out of the editor.
                const focused = document.activeElement
                if (!focused || focused === document.body || root.contains(focused)) focusAnchorTarget(anchorTarget)
                return stopHolding
            }
            // A link such as `other.md#top`, with nothing in it called that, opens it at the top.
            if (opened && tabId && isTopOfDocument(opened.id)) scrollTopByTab.delete(tabId)
        }

        const scrollTop = (tabId ? scrollTopByTab.get(tabId) : undefined) ?? 0
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
    }, [tabId, expandedKey, scrollTopByTab])

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
                    {previewIsEmpty ? (
                        <PreviewEmpty />
                    ) : (
                        // A document the parser can't take (thousands of nested quotes) breaks only the preview.
                        <PaneErrorBoundary resetKeys={[tabId, previewSource]} fallback={previewCrashNotice}>
                            <MarkdownPreview
                                source={previewSource}
                                tabId={tabId}
                                onExpandBlock={onExpandBlock}
                                onLinkClick={onLinkClick}
                                loadRemoteImages={loadRemoteImages}
                                onRemoteImageBlocked={onRemoteImageBlocked}
                                documentPath={documentPath}
                                workspaceRoot={workspaceRoot}
                            />
                        </PaneErrorBoundary>
                    )}
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
                            variant="outline"
                            size="sm"
                            className={cn('h-8 gap-1.5', overlayButtonClassName)}
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
