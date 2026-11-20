/**
 * Shared by the drags done with pointer events (explorer rows, editor tabs). Not the browser's drag and drop:
 * the window's own handling of files dropped from File Explorer keeps that from working inside it on Windows.
 */

/** How far (px) the pointer moves with the button held before something is dragged rather than clicked. */
export const DRAG_START_PX = 4

/** True once the pointer has gone far enough from where the button went down to start a drag. */
export function pastDragStart(start: { x: number; y: number }, x: number, y: number): boolean {
    return Math.hypot(x - start.x, y - start.y) >= DRAG_START_PX
}

/** Stops the click the browser sends as the button is let go after a drag, which would open or show what is under it. */
export function swallowNextClick() {
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
    // When no click comes (let go over another element), the next press and its click are new ones.
    document.addEventListener('pointerdown', stop, true)
    setTimeout(stop, 0)
}
