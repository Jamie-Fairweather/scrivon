/** The app's zoom steps, as browsers have them: 50% to 200%. 1 is 100%. */
export const APP_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

/**
 * An element that zooms itself (the diagram canvas, marked `data-own-zoom`). Ctrl+wheel over it, and
 * the zoom keys while it has focus, are left to it, so its zoom and the app's never both happen.
 */
export const OWN_ZOOM_SELECTOR = '[data-own-zoom]'

export const DEFAULT_APP_ZOOM = 1
export const MIN_APP_ZOOM = APP_ZOOM_LEVELS[0]
export const MAX_APP_ZOOM = APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1]

/** The next step up from `zoom`, or the top step. */
export function zoomInStep(zoom: number): number {
    return APP_ZOOM_LEVELS.find((level) => level > zoom) ?? MAX_APP_ZOOM
}

/** The next step down from `zoom`, or the bottom step. */
export function zoomOutStep(zoom: number): number {
    return APP_ZOOM_LEVELS.findLast((level) => level < zoom) ?? MIN_APP_ZOOM
}

/** A saved zoom as one of the steps: the nearest one, or 100% when it isn't a usable number. */
export function normalizeAppZoom(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_APP_ZOOM
    return APP_ZOOM_LEVELS.reduce((nearest, level) => (Math.abs(level - value) < Math.abs(nearest - value) ? level : nearest))
}

/** How far a Ctrl+wheel must move, in pixels, for one zoom step. A mouse notch is about 100. */
const WHEEL_STEP_PX = 50

export type WheelZoomInput = Pick<WheelEvent, 'deltaY' | 'deltaMode'>

/**
 * Turns Ctrl+wheel movement into zoom steps: 1 to zoom in, -1 to zoom out, 0 for none yet. A mouse
 * notch is one step. A touchpad pinch (which arrives as Ctrl+wheel too) sends many small amounts,
 * so they add up first.
 */
export function createWheelZoom(): (input: WheelZoomInput) => -1 | 0 | 1 {
    let total = 0
    return ({ deltaY, deltaMode }) => {
        if (deltaY === 0) return 0
        // Line and page amounts only come from mouse wheels: a step each.
        const amount = deltaMode === 0 ? deltaY : Math.sign(deltaY) * WHEEL_STEP_PX
        if (Math.sign(amount) !== Math.sign(total)) total = 0
        total += amount
        if (Math.abs(total) < WHEEL_STEP_PX) return 0
        const step = total < 0 ? 1 : -1
        total = 0
        return step
    }
}

/** 1.25 → '125%'. */
export function formatZoomPercent(zoom: number): string {
    return `${Math.round(zoom * 100)}%`
}
