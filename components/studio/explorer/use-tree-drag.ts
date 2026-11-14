'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { notifyError } from '@/lib/notify'
import { registerFileDropTarget } from '@/lib/tauri/file-drop'
import { moveRefusal } from '@/lib/workspace/move-entry'
import type { FileNode } from '@/lib/workspace/types'

/** How far (px) the pointer moves with the button held before a row is dragged rather than clicked. */
const DRAG_START_PX = 4

/**
 * The folder something let go at the point goes into: the folder row under it, the folder of the file row under
 * it, or the open folder for the space around the rows (each marks itself with `data-drop-folder`). Null
 * outside the tree, and over a folder that can't be read (its `data-drop-folder` is empty).
 */
export function dropFolderAt(x: number, y: number): string | null {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-folder]')?.dataset.dropFolder || null
}

/** A row being dragged: where the pointer is, and the folder it would go into there (null where it can't go). */
export type TreeDrag = { node: FileNode; x: number; y: number; target: string | null }

/** Stops the click the browser sends as the button is let go after a drag, which would open the row under it. */
function swallowNextClick() {
    const swallow = (event: MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
        stop()
    }
    const stop = () => {
        document.removeEventListener('click', swallow, true)
        document.removeEventListener('pointerdown', stop, true)
    }
    document.addEventListener('click', swallow, true)
    // When no click comes (let go over another row), the next press and its click are new ones.
    document.addEventListener('pointerdown', stop, true)
    setTimeout(stop, 0)
}

/**
 * Dragging rows of the tree onto folders with the mouse. Pointer events, not the browser's drag and drop: the
 * window's own handling of files dropped from File Explorer keeps that from working inside it on Windows.
 * Escape stops a drag. Returns the drag under way, and what a press on a row calls to start one.
 */
export function useRowDrag(onDrop: (node: FileNode, folder: string) => void) {
    const [drag, setDrag] = useState<TreeDrag | null>(null)
    const onDropRef = useRef(onDrop)
    useLayoutEffect(() => {
        onDropRef.current = onDrop
    }, [onDrop])
    const endRef = useRef<(() => void) | null>(null)
    useEffect(() => () => endRef.current?.(), [])

    const startDrag = useCallback((node: FileNode, event: ReactPointerEvent) => {
        if (event.button !== 0) return
        endRef.current?.()
        const start = { x: event.clientX, y: event.clientY }
        let current: TreeDrag | null = null
        let cancelled = false

        const end = () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', end)
            document.removeEventListener('keydown', onKey, true)
            window.removeEventListener('blur', end)
            endRef.current = null
            setDrag(null)
        }
        const onMove = (e: PointerEvent) => {
            // Let go outside the window, where the page doesn't hear it.
            if (e.buttons === 0) return end()
            if (cancelled || (!current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_PX)) return
            const folder = dropFolderAt(e.clientX, e.clientY)
            const target = folder !== null && moveRefusal(node.path, node.kind === 'directory', folder) === null ? folder : null
            current = { node, x: e.clientX, y: e.clientY, target }
            setDrag(current)
        }
        const onUp = () => {
            end()
            if (!current) return
            swallowNextClick()
            if (!cancelled && current.target) onDropRef.current(node, current.target)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || !current || cancelled) return
            e.preventDefault()
            e.stopPropagation()
            cancelled = true
            setDrag(null)
        }

        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', end)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('blur', end)
        endRef.current = end
    }, [])

    return { drag, startDrag }
}

/**
 * Lets the tree's area (`zoneRef`) take files dropped from File Explorer: they are copied into the folder they
 * land on (`copyIntoFolder`), or the open folder (`root`) beside the rows. Files already in that folder aren't
 * copied; they go on to the window, which opens them. Returns the folder they would go into while they are
 * dragged over it, else null.
 */
export function useFileDropZone(
    zoneRef: RefObject<HTMLElement | null>,
    root: string | null,
    copyIntoFolder: (sources: readonly string[], folder: string) => Promise<void>
): string | null {
    const [over, setOver] = useState<string | null>(null)
    // The latest, for drops: it changes as the tree is read again, which mustn't drop the mark mid-drag.
    const copyRef = useRef(copyIntoFolder)
    useLayoutEffect(() => {
        copyRef.current = copyIntoFolder
    }, [copyIntoFolder])
    useEffect(() => {
        const zone = zoneRef.current
        if (!zone || !root) return
        const stop = registerFileDropTarget(
            zone,
            ({ paths, x, y }) => {
                const folder = dropFolderAt(x, y)
                // Over a folder that can't be read nothing goes in, as when a row is dragged there.
                if (!folder) return []
                // Already there, so nothing to copy: they open, as when dropped anywhere else in the window.
                const there = paths.filter((path) => moveRefusal(path, true, folder) === 'same-folder')
                const copying = paths.filter((path) => !there.includes(path))
                if (copying.length > 0) {
                    copyRef.current(copying, folder).catch((err: unknown) => notifyError("Couldn't copy the dropped files", err))
                }
                return there
            },
            (point) => setOver(point ? dropFolderAt(point.x, point.y) : null)
        )
        return () => {
            stop()
            setOver(null)
        }
    }, [zoneRef, root])
    return over
}
