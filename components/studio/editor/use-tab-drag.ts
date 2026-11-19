'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { pastDragStart, swallowNextClick } from '@/lib/ui/pointer-drag'
import { dropIndexAt, indexAfterDrop } from '@/lib/workspace/document-tab'

/**
 * A tab being dragged along the strip, and the gap it would land in if let go now (0 to the number of tabs), or
 * null while the pointer is above or below the tab bar, where letting go puts everything back.
 */
export type TabDrag = { id: string; dropIndex: number | null }

type TabDragOptions = {
    /** The strip the tabs are in. Letting go above or below it cancels. */
    stripRef: RefObject<HTMLElement | null>
    /** The ids of the tabs, in strip order. */
    tabIds: readonly string[]
    /** The element of each tab, whose middle decides which side of it a dragged tab lands. */
    tabElement: (id: string) => HTMLElement | undefined
    /** Called when a tab is let go somewhere else, with the index it should end up at. */
    onMove: (id: string, toIndex: number) => void
}

/**
 * Dragging tabs along the strip with the mouse to put them in another order. Pointer events, not the browser's
 * drag and drop, which the window's own handling of files dropped from File Explorer stops working on Windows.
 * A press that doesn't move far is still a click. Escape puts everything back. Returns the drag under way, and
 * what a press on a tab calls to start one.
 */
export function useTabDrag({ stripRef, tabIds, tabElement, onMove }: TabDragOptions) {
    const [drag, setDrag] = useState<TabDrag | null>(null)
    // The latest, read as the pointer moves: the tabs can change mid-drag (one closes, another opens).
    const latest = useRef({ tabIds, tabElement, onMove })
    useLayoutEffect(() => {
        latest.current = { tabIds, tabElement, onMove }
    }, [tabIds, tabElement, onMove])
    const endRef = useRef<(() => void) | null>(null)
    useEffect(() => () => endRef.current?.(), [])

    const startDrag = useCallback(
        (id: string, event: ReactPointerEvent) => {
            if (event.button !== 0) return
            endRef.current?.()
            const start = { x: event.clientX, y: event.clientY }
            let current: TabDrag | null = null
            let cancelled = false

            /** The gap the tab would land in at this point, or null above or below the strip. */
            const dropIndexAtPoint = (x: number, y: number): number | null => {
                const strip = stripRef.current?.getBoundingClientRect()
                if (!strip || y < strip.top || y > strip.bottom) return null
                const { tabIds: ids, tabElement: elementOf } = latest.current
                const rects = ids.flatMap((tabId) => {
                    const element = elementOf(tabId)
                    return element ? [element.getBoundingClientRect()] : []
                })
                return dropIndexAt(x, rects)
            }

            const end = () => {
                document.removeEventListener('pointermove', onPointerMove)
                document.removeEventListener('pointerup', onUp)
                document.removeEventListener('pointercancel', end)
                document.removeEventListener('keydown', onKey, true)
                window.removeEventListener('blur', end)
                endRef.current = null
                setDrag(null)
            }
            const onPointerMove = (e: PointerEvent) => {
                // Let go outside the window, where the page doesn't hear it.
                if (e.buttons === 0) return end()
                if (cancelled || (!current && !pastDragStart(start, e.clientX, e.clientY))) return
                current = { id, dropIndex: dropIndexAtPoint(e.clientX, e.clientY) }
                setDrag(current)
            }
            const onUp = (e: PointerEvent) => {
                end()
                if (!current) return
                // The click that follows would show the tab under the pointer.
                swallowNextClick()
                if (cancelled) return
                const dropIndex = dropIndexAtPoint(e.clientX, e.clientY)
                const from = latest.current.tabIds.indexOf(id)
                if (dropIndex === null || from === -1) return
                const to = indexAfterDrop(from, dropIndex)
                // Let go either side of itself, it stays where it was.
                if (to !== from) latest.current.onMove(id, to)
            }
            const onKey = (e: KeyboardEvent) => {
                if (e.key !== 'Escape' || !current || cancelled) return
                e.preventDefault()
                e.stopPropagation()
                cancelled = true
                setDrag(null)
            }

            document.addEventListener('pointermove', onPointerMove)
            document.addEventListener('pointerup', onUp)
            document.addEventListener('pointercancel', end)
            document.addEventListener('keydown', onKey, true)
            window.addEventListener('blur', end)
            endRef.current = end
        },
        [stripRef]
    )

    return { drag, startDrag }
}
