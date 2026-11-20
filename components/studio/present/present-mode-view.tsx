'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useFrameSyncedValue } from '@/components/studio/hooks/use-frame-synced-value'
import { DiagramHeightLimitContext } from '@/components/studio/markdown/embedded-mermaid-block'
import { useMarkdownPreviewMemory } from '@/components/studio/markdown/markdown-expand-context'
import { resolveMarkdownLink } from '@/components/studio/markdown/markdown-links'
import { MarkdownPreview } from '@/components/studio/markdown/markdown-preview'
import { openExternalLink } from '@/components/studio/markdown/open-external-link'
import { usePresentMode } from '@/components/studio/present/present-mode-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { DialogErrorBoundary } from '@/components/studio/shell/dialog-error-boundary'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogPrimitive } from '@/components/ui/dialog'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError } from '@/lib/notify'
import { DEFAULT_PREVIEW_FONT_SIZE } from '@/lib/zoom/preview-text-size'
import type { DocumentTab } from '@/lib/workspace/types'

/** As in the preview: above this length, the slides wait for a short pause in typing before they are drawn again. */
const LARGE_PREVIEW_CHARS = 10_000
const LARGE_PREVIEW_DELAY_MS = 200

/** The slide's padding above and below the text (py-12), outside the text's own scaled spacing. */
const SLIDE_PADDING_Y = 96

export type SlideKeyAction = 'next' | 'previous' | 'first' | 'last' | 'exit'

/** Keys on a button or link that are its own: Space and Enter press it, rather than moving to the next slide. */
function isPressable(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('button, a[href], [role="button"], input, select, textarea') !== null
}

/**
 * What a key does in present mode, or null to leave it alone: Right, Down, Page Down and Space go forward; Left, Up
 * and Page Up go back; Home and End go to the first and last slide; Esc leaves. Keys held with Ctrl, Alt or the
 * Windows key are the app's (zoom) or the system's, and Space on a button presses the button.
 */
export function slideKeyAction(
    event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'> & { target: EventTarget | null }
): SlideKeyAction | null {
    if (event.key === 'Escape') return 'exit'
    if (event.ctrlKey || event.altKey || event.metaKey) return null
    switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
            return 'next'
        case ' ':
            return isPressable(event.target) ? null : 'next'
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
            return 'previous'
        case 'Home':
            return 'first'
        case 'End':
            return 'last'
        default:
            return null
    }
}

/**
 * How much larger than the preview a slide's text is: more on a bigger screen, within limits, on top of the Preview
 * text size setting. Set as --preview-text-scale, which `.preview-text` sizes the text and spacing by.
 */
export function slideTextScale(width: number, height: number, previewFontSize: number): number {
    const screen = Math.min(width / 800, height / 500)
    const slide = Math.min(2.25, Math.max(1.25, Number.isFinite(screen) ? screen : 0))
    return (previewFontSize / DEFAULT_PREVIEW_FONT_SIZE) * slide
}

/** The slide's place in the document, as the counter shows it and a screen reader says it. */
export function slideLabel(index: number, count: number): string {
    return `Slide ${index + 1} of ${count}`
}

/** A blocked web image needs nothing more here: present mode has no "Load images" bar. It follows the preview's choice. */
const ignoreBlockedImage = () => () => {}
const noExpand = () => {}

type PresentSlidesProps = {
    tab: DocumentTab
    onExit: () => void
}

function PresentSlides({ tab, onExit }: PresentSlidesProps) {
    const source = useFrameSyncedValue(tab.content, tab.id, tab.content.length > LARGE_PREVIEW_CHARS ? LARGE_PREVIEW_DELAY_MS : 0)
    const { workspaceRoot } = useWorkspaceSession()
    const { remoteImageTabs } = useMarkdownPreviewMemory()
    const { previewFontSize } = useAppSettings().settings.appearance
    const documentPath = isExampleTabId(tab.id) ? null : tab.path
    const viewportRef = useRef<HTMLDivElement>(null)
    const [index, setIndex] = useState(0)
    const [count, setCount] = useState(0)
    const [size, setSize] = useState({ width: 0, height: 0 })
    /** What a screen reader hears when the slide changes; empty until it first does. */
    const [announcement, setAnnouncement] = useState('')

    // The slides are counted on the page once they are drawn, so the document is parsed only once. When the text
    // changes, the slide number stays, or moves back to the last slide if there are now fewer.
    useLayoutEffect(() => {
        const slides = viewportRef.current?.querySelectorAll('section[data-slide]').length ?? 0
        setCount(slides)
        setIndex((current) => Math.min(current, Math.max(0, slides - 1)))
    }, [source])

    // Each slide starts at its top.
    useLayoutEffect(() => {
        if (viewportRef.current) viewportRef.current.scrollTop = 0
    }, [index])

    useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const update = () =>
            setSize((last) =>
                last.width === viewport.clientWidth && last.height === viewport.clientHeight
                    ? last
                    : { width: viewport.clientWidth, height: viewport.clientHeight }
            )
        update()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(update)
        observer.observe(viewport)
        return () => observer.disconnect()
    }, [])

    const goTo = useCallback(
        (next: number) => {
            if (count === 0) return
            const clamped = Math.min(count - 1, Math.max(0, next))
            if (clamped === index) return
            setIndex(clamped)
            setAnnouncement(slideLabel(clamped, count))
        },
        [count, index]
    )

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return
        const action = slideKeyAction(event)
        if (!action) return
        event.preventDefault()
        if (action === 'exit') onExit()
        else if (action === 'next') goTo(index + 1)
        else if (action === 'previous') goTo(index - 1)
        else if (action === 'first') goTo(0)
        else goTo(count - 1)
    }

    // Only web links are followed. Links to a heading, a footnote or a file do nothing on a slide.
    const onLinkClick = useCallback(
        (href: string) => {
            const target = resolveMarkdownLink(href, { documentPath, workspaceRoot })
            if (target.kind === 'external') openExternalLink(target.url)
        },
        [documentPath, workspaceRoot]
    )

    const scale = slideTextScale(size.width, size.height, previewFontSize)
    // A diagram fits on the slide whole: the slide's height less its padding and the diagram's own margin (my-4).
    const diagramHeight = size.height > 0 ? Math.max(120, size.height - SLIDE_PADDING_Y - 32 * scale) : null
    const atStart = index === 0
    const atEnd = count === 0 || index === count - 1

    return (
        <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
            <div
                ref={viewportRef}
                data-slot="present-viewport"
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-y-auto outline-none"
                style={{ '--preview-text-scale': String(scale) } as CSSProperties}
            >
                <DiagramHeightLimitContext.Provider value={diagramHeight}>
                    <MarkdownPreview
                        source={source}
                        tabId={tab.id}
                        documentKey={`${tab.id}:present`}
                        variant="slides"
                        slide={index}
                        onExpandBlock={noExpand}
                        onLinkClick={onLinkClick}
                        loadRemoteImages={remoteImageTabs.has(tab.id)}
                        onRemoteImageBlocked={ignoreBlockedImage}
                        documentPath={documentPath}
                        workspaceRoot={workspaceRoot}
                        className="items-center px-12 py-12"
                    />
                </DiagramHeightLimitContext.Provider>
                {count === 0 ? (
                    <p lang="en" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        Nothing to present. Add some text to the document.
                    </p>
                ) : null}
            </div>
            {/* Scrivon's own words, in English whatever the document's language. */}
            <div
                lang="en"
                role="group"
                aria-label="Slide controls"
                className="absolute end-3 bottom-3 flex items-center gap-1 text-xs text-muted-foreground"
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous slide"
                    title="Previous slide (Left)"
                    aria-disabled={atStart || undefined}
                    className="aria-disabled:opacity-40"
                    onClick={() => goTo(index - 1)}
                >
                    <ChevronLeft />
                </Button>
                <span data-slot="slide-counter" aria-hidden className="min-w-12 text-center tabular-nums">
                    {count === 0 ? '0 / 0' : `${index + 1} / ${count}`}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next slide"
                    title="Next slide (Right)"
                    aria-disabled={atEnd || undefined}
                    className="aria-disabled:opacity-40"
                    onClick={() => goTo(index + 1)}
                >
                    <ChevronRight />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close present mode" title="Close (Esc)" onClick={onExit}>
                    <X />
                </Button>
            </div>
            <p lang="en" className="sr-only" aria-live="polite">
                {announcement}
            </p>
        </div>
    )
}

/**
 * Present mode: the tab PresentModeProvider names, as full-window slides over everything else, in a modal dialog,
 * so focus stays inside, goes back where it was on the way out, and the app's shortcuts (but zoom) are off behind
 * it. Lives in the layout, inside the preview's per-tab memory, so web images follow the tab's "Load images" choice.
 */
export function PresentModeView() {
    const { presentingTabId, exit } = usePresentMode()
    const { tabs } = useDocumentTabs()
    const tab = presentingTabId === null ? undefined : tabs.find((t) => t.id === presentingTabId)
    const open = tab !== undefined
    const exitRef = useRef(exit)
    const mountedRef = useRef(false)

    useEffect(() => {
        exitRef.current = exit
    }, [exit])

    // The tab closed while presenting (its file was deleted, say).
    useEffect(() => {
        if (presentingTabId !== null && !open) void exit()
    }, [presentingTabId, open, exit])

    // The view going (the folder closed, or the layout crashed) ends present mode and puts the window back. Checked a
    // moment later, so React's development double mount doesn't end it as it starts.
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            queueMicrotask(() => {
                if (!mountedRef.current) void exitRef.current()
            })
        }
    }, [])

    const onOpenChange = useCallback(
        (next: boolean) => {
            if (!next) void exit()
        },
        [exit]
    )

    // A slide that can't be drawn closes present mode with a notice, rather than taking the studio down with it.
    const onCrash = useCallback(
        (error: Error) => {
            void exit()
            notifyError("Couldn't present the document", error, {
                description: "Something went wrong while drawing a slide. Your document wasn't changed.",
            })
        },
        [exit]
    )

    const onExit = useCallback(() => void exit(), [exit])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogPrimitive.Popup
                    // Not a "…dialog-popup", which the title bar's window controls stay above (TITLEBAR_ABOVE_DIALOGS_CLASS):
                    // the slides cover the whole window. Notifications still show over them.
                    data-slot="present-popup"
                    className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
                    initialFocus={() => document.querySelector<HTMLElement>('[data-slot="present-viewport"]') ?? true}
                >
                    <DialogPrimitive.Title lang="en" className="sr-only">
                        {tab ? `Presenting ${tab.name}` : 'Present mode'}
                    </DialogPrimitive.Title>
                    <DialogErrorBoundary open={open} onCrash={onCrash}>
                        {tab ? <PresentSlides key={tab.id} tab={tab} onExit={onExit} /> : null}
                    </DialogErrorBoundary>
                </DialogPrimitive.Popup>
            </DialogPortal>
        </Dialog>
    )
}
