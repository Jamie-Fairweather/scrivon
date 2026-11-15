'use client'

import { useEffect, type RefObject } from 'react'
import { editorPreviewSync, USER_EVENTS, type EditorPreviewSync, type SourceBlock } from '@/components/studio/markdown/editor-preview-sync'

/** Double-clicking these does something of their own, so it doesn't jump to the editor. */
const OWN_CLICK = 'a, button, input, select, textarea, summary, [role="button"]'

/** The element that scrolls inside a scroll area. */
export function scrollViewport(root: HTMLElement | null): HTMLElement | null {
    return root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
}

/** Each marked block, measured from the top of the preview's content. Blocks that take no space (in a closed <details>) are left out. */
function measureBlocks(viewport: HTMLElement): SourceBlock[] {
    const origin = viewport.getBoundingClientRect().top - viewport.scrollTop
    const blocks: SourceBlock[] = []
    for (const element of viewport.querySelectorAll<HTMLElement>('[data-source-line]')) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        blocks.push({ line: Number(element.dataset.sourceLine), top: rect.top - origin })
    }
    return blocks
}

/**
 * Links the Markdown preview in `rootRef` to the editor (see createEditorPreviewSync): it scrolls with the editor,
 * the editor scrolls with it, and double-clicking a block moves the editor to that block's line. `content` is what
 * the preview shows, so the preview lines up again when it changes.
 */
export function usePreviewScrollSync(
    rootRef: RefObject<HTMLElement | null>,
    tabId: string | null,
    content: unknown,
    sync: EditorPreviewSync = editorPreviewSync
) {
    useEffect(() => {
        const root = rootRef.current
        const viewport = scrollViewport(root)
        if (!root || !viewport) return

        const unregister = sync.registerPreview({
            tabId: () => tabId,
            scrollTop: () => viewport.scrollTop,
            maxScrollTop: () => Math.max(0, viewport.scrollHeight - viewport.clientHeight),
            setScrollTop: (top) => {
                viewport.scrollTop = top
            },
            blocks: () => measureBlocks(viewport),
        })
        const onScroll = () => sync.scrolled('preview')
        const onUserEvent = () => sync.touched('preview')
        const onDoubleClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null
            if (!target || target.closest(OWN_CLICK)) return
            const block = target.closest<HTMLElement>('[data-source-line]')
            if (block && viewport.contains(block)) sync.jumpToLine(Number(block.dataset.sourceLine))
        }
        viewport.addEventListener('scroll', onScroll, { passive: true })
        // Before the scrollbars and blocks see them, which may stop them going further.
        for (const type of USER_EVENTS) root.addEventListener(type, onUserEvent, { capture: true, passive: true })
        root.addEventListener('dblclick', onDoubleClick)
        return () => {
            unregister()
            viewport.removeEventListener('scroll', onScroll)
            for (const type of USER_EVENTS) root.removeEventListener(type, onUserEvent, { capture: true })
            root.removeEventListener('dblclick', onDoubleClick)
        }
    }, [rootRef, tabId, sync])

    useEffect(() => {
        sync.previewChanged()
        // Diagrams drawn and images loaded move the blocks below them. Watched afresh each time, as the content
        // element changes when the preview goes from empty to a document.
        const contentElement = scrollViewport(rootRef.current)?.firstElementChild
        if (!contentElement || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => sync.previewChanged())
        observer.observe(contentElement)
        return () => observer.disconnect()
    }, [rootRef, content, sync])
}
