import { getCurrentWebview } from '@tauri-apps/api/webview'
import { isTauri } from '@/lib/tauri/platform'

/** Files dragged in from outside the app (File Explorer) and dropped, and where they landed, in page pixels. */
export type FileDrop = { paths: readonly string[]; x: number; y: number }

/**
 * Takes the dropped files it can use and returns the rest, for the drop target around it. It can return them once
 * its own work is done, so the rest are dealt with after it (a document dropped with an image opens once the
 * image is linked).
 */
export type FileDropHandler = (drop: FileDrop) => readonly string[] | Promise<readonly string[]>

/** Where files being dragged in are over the target, in page pixels, or null once they aren't (or were dropped). */
export type FileDragHover = (point: { x: number; y: number } | null) => void

type Target = { handler: FileDropHandler; onHover?: FileDragHover }

const targets = new Map<Element, Target>()

/**
 * Lets `element` take files dropped onto it, before the targets around it. `onHover` hears where files being
 * dragged in are over it, to show where they would go. Returns the function that stops it.
 */
export function registerFileDropTarget(element: Element, handler: FileDropHandler, onHover?: FileDragHover): () => void {
    const target: Target = { handler, onHover }
    targets.set(element, target)
    return () => {
        if (targets.get(element) === target) targets.delete(element)
    }
}

/** The drop targets under the point, innermost first. */
function targetsAt(x: number, y: number): Target[] {
    const found: Target[] = []
    for (let element = document.elementFromPoint(x, y); element; element = element.parentElement) {
        const target = targets.get(element)
        if (target) found.push(target)
    }
    return found
}

/** Tells each target with an `onHover` whether the files are over it (`under`), and where. */
function hover(under: readonly Target[], point: { x: number; y: number } | null) {
    for (const target of targets.values()) target.onHover?.(under.includes(target) ? point : null)
}

/**
 * Listens for files dropped onto the window (desktop app only). Each drop goes to the drop targets under it,
 * innermost first, one after another, and `onRest` gets the files none of them took. Resolves to the function
 * that stops listening.
 *
 * Windows hands the app the files' paths, and the fs plugin lets the page read the files dropped (only those).
 */
export async function listenForFileDrops(onRest: (drop: FileDrop) => void): Promise<() => void> {
    if (!isTauri()) return () => {}
    return getCurrentWebview().onDragDropEvent(async ({ payload }) => {
        if (payload.type === 'leave') {
            hover([], null)
            return
        }
        // The position is in screen pixels; the page measures in CSS pixels.
        const scale = window.devicePixelRatio || 1
        const x = payload.position.x / scale
        const y = payload.position.y / scale
        if (payload.type !== 'drop') {
            hover(targetsAt(x, y), { x, y })
            return
        }
        // Found straight away, while the page is as it was at the drop.
        const handlers = targetsAt(x, y).map((target) => target.handler)
        hover([], null)
        if (payload.paths.length === 0) return
        let paths: readonly string[] = payload.paths
        for (const handler of handlers) {
            if (paths.length === 0) return
            paths = await handler({ paths, x, y })
        }
        if (paths.length > 0) onRest({ paths, x, y })
    })
}
