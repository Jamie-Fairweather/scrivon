'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

/** Low enough for Fit to show a very wide or tall diagram whole (a 7,000 px chain in a 600 px pane needs about 8%). */
const MIN_SCALE = 0.02
/** Highest manual zoom. */
const MAX_SCALE = 5
/** Fit never enlarges past this, so a two-node diagram isn't blown up to 500%. */
const FIT_MAX_SCALE = 1.5
const FIT_PADDING = 24
const LINE_HEIGHT_PX = 16
/** Zoom per pixel of wheel movement for a mouse notch: about 10% per notch. */
const NOTCH_ZOOM_RATE = 0.001
/** Zoom per pixel for a touchpad pinch, which Chromium sends as ctrl+wheel with deltaY = -100 * ln(scale). */
const PINCH_ZOOM_RATE = 0.01

/** Zoom per click of a zoom button or press of a zoom key. */
const ZOOM_STEP = 1.25
/** How far an arrow key moves the diagram, in screen pixels; Shift moves it further. */
const PAN_STEP = 50
const PAN_STEP_LARGE = 200

/** What the zoom buttons, keys and menu items do. */
export type DiagramZoom = 'in' | 'out' | 'reset'

const ZOOM_KEYS = new Map<string, DiagramZoom>([
    ['+', 'in'],
    ['=', 'in'],
    ['-', 'out'],
    ['_', 'out'],
    ['0', 'reset'],
])

/** Like scrolling: Right shows more of the right side, so the diagram moves left. */
const PAN_KEYS = new Map<string, Point>([
    ['ArrowLeft', { x: 1, y: 0 }],
    ['ArrowRight', { x: -1, y: 0 }],
    ['ArrowUp', { x: 0, y: 1 }],
    ['ArrowDown', { x: 0, y: -1 }],
])

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

type KeyGesture = { kind: 'zoom'; how: DiagramZoom } | { kind: 'pan'; dx: number; dy: number }

/**
 * Keys on the focused canvas: + - 0 zoom (with or without Ctrl, so the diagram's zoom wins over
 * the app's), and the arrow keys move the diagram. Alt is left for app shortcuts and the menu bar.
 */
function interpretKey(input: KeyInput): KeyGesture | null {
    if (input.altKey) return null
    const how = ZOOM_KEYS.get(input.key)
    if (how) return { kind: 'zoom', how }
    const direction = PAN_KEYS.get(input.key)
    if (!direction || input.ctrlKey || input.metaKey) return null
    const step = input.shiftKey ? PAN_STEP_LARGE : PAN_STEP
    return { kind: 'pan', dx: direction.x * step, dy: direction.y * step }
}

/** Wheel events from inside an element with this attribute (e.g. a scrollable error banner) are left to the browser. */
export const NO_CANVAS_GESTURES_ATTRIBUTE = 'data-canvas-no-gestures'

/** For things on the canvas (buttons, messages): a click there is theirs, not the start of a drag or a double-click reset. */
export function stopCanvasGesture(event: React.SyntheticEvent) {
    event.stopPropagation()
}

export function computeFitTransform(
    containerWidth: number,
    containerHeight: number,
    contentWidth: number,
    contentHeight: number,
    padding = FIT_PADDING
): PanZoomState {
    const availableW = Math.max(0, containerWidth - padding * 2)
    const availableH = Math.max(0, containerHeight - padding * 2)
    const scale = Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, Math.min(availableW / contentWidth, availableH / contentHeight)))
    // Content is flex-centered; pan offset (0,0) with scale fits the viewport.
    return { x: 0, y: 0, scale }
}

/** Reset view: centered at 100% scale (content wrapper is flex-centered). */
export function computeCenterTransform(): PanZoomState {
    return { x: 0, y: 0, scale: 1 }
}

export type PanZoomState = {
    x: number
    y: number
    scale: number
}

type Point = { x: number; y: number }

export type WheelInput = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey'> & {
    /** Legacy field: whole multiples of 120 for mouse-wheel notches, small or zero for touchpads. */
    wheelDeltaY?: number
}

export type WheelGesture = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

/** Mouse wheels move in whole notches; touchpads send small, smooth amounts and often sideways movement too. */
function isMouseNotch(input: WheelInput, dy: number): boolean {
    if (input.deltaMode !== 0) return true // line and page units only come from mouse wheels
    if (input.deltaX !== 0 || dy === 0) return false
    if (typeof input.wheelDeltaY === 'number') return input.wheelDeltaY !== 0 && input.wheelDeltaY % 120 === 0
    return Number.isInteger(dy) && (dy % 100 === 0 || dy % 120 === 0)
}

/**
 * Pinch (ctrl+wheel on touchpads), Ctrl/Cmd+wheel and a mouse wheel zoom. Two-finger touchpad
 * scrolling, and Shift+wheel on a mouse (which arrives sideways), pan the diagram.
 */
export function interpretWheel(input: WheelInput, pageHeight: number): WheelGesture {
    const unit = input.deltaMode === 1 ? LINE_HEIGHT_PX : input.deltaMode === 2 ? pageHeight : 1
    const dx = input.deltaX * unit
    const dy = input.deltaY * unit
    const notch = isMouseNotch(input, dy)

    if (input.ctrlKey || input.metaKey || notch) {
        // exp() never reaches zero, and zooming in then out by the same amount ends where it started.
        return { kind: 'zoom', factor: Math.exp(-dy * (notch ? NOTCH_ZOOM_RATE : PINCH_ZOOM_RATE)) }
    }
    return { kind: 'pan', dx, dy }
}

/** Keeps the scale in range, but never snaps a view that is already outside it back on the next tick. */
export function clampScale(next: number, current: number): number {
    const low = Math.min(MIN_SCALE, current)
    const high = Math.max(MAX_SCALE, current)
    return Math.min(high, Math.max(low, next))
}

/** Zooms so the diagram point under `point` (relative to the container's centre) stays put. */
export function zoomAround(prev: PanZoomState, scale: number, point: Point): PanZoomState {
    const contentX = (point.x - prev.x) / prev.scale
    const contentY = (point.y - prev.y) / prev.scale
    return { x: point.x - contentX * scale, y: point.y - contentY * scale, scale }
}

/** Two-finger pinch: scales by how far the fingers spread and follows their midpoint. */
export function pinchTransform(start: PanZoomState, startMid: Point, startDistance: number, mid: Point, distance: number): PanZoomState {
    const scale = clampScale(start.scale * (distance / startDistance), start.scale)
    const zoomed = zoomAround(start, scale, startMid)
    return { ...zoomed, x: zoomed.x + mid.x - startMid.x, y: zoomed.y + mid.y - startMid.y }
}

function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function distanceBetween(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

function toTransform({ x, y, scale }: PanZoomState) {
    return `translate(${x}px, ${y}px) scale(${scale})`
}

const DEFAULT_STATE: PanZoomState = { x: 0, y: 0, scale: 1 }

type PointerGesture = { start: PanZoomState; origin: Point; distance: number }

/** The view's zoom (1 is 100%), to show with useSyncExternalStore. Moving the diagram doesn't count as a change. */
export type ZoomLevel = {
    subscribe: (onChange: () => void) => () => void
    getScale: () => number
}

/** Each view's pan and zoom, by tab id (or canvas key). */
export type PanZoomMemory = Map<string, PanZoomState>

function forgetClosedTabs(memory: PanZoomMemory, openTabIds: readonly string[]): void {
    const open = new Set(openTabIds)
    for (const key of memory.keys()) {
        if (!open.has(key)) memory.delete(key)
    }
}

/**
 * Pan and zoom for every open tab, for a component that stays mounted while the diagram canvas is swapped
 * out for a Markdown tab, so a diagram comes back as it was left. A tab that closes is forgotten, so the file
 * is fitted afresh when it opens again.
 */
export function usePanZoomMemory(openTabIds: readonly string[]): PanZoomMemory {
    const [memory] = useState<PanZoomMemory>(() => new Map())
    useEffect(() => forgetClosedTabs(memory, openTabIds), [memory, openTabIds])
    return memory
}

/** Without `memory`, each tab's view lasts only as long as the calling component. */
export function usePanZoom(
    containerRef: RefObject<HTMLElement | null>,
    transformRef: RefObject<HTMLElement | null>,
    tabId: string | null,
    openTabIds: string[] = [],
    memory?: PanZoomMemory
) {
    const stateRef = useRef<PanZoomState>(DEFAULT_STATE)
    const [ownMemory] = useState<PanZoomMemory>(() => new Map())
    const statesByTab = memory ?? ownMemory
    const tabIdRef = useRef(tabId)
    const pointersRef = useRef(new Map<number, Point>())
    const gestureRef = useRef<PointerGesture | null>(null)

    const [scaleListeners] = useState(() => new Set<() => void>())

    const zoomLevel = useMemo<ZoomLevel>(
        () => ({
            subscribe: (onChange) => {
                scaleListeners.add(onChange)
                return () => scaleListeners.delete(onChange)
            },
            getScale: () => stateRef.current.scale,
        }),
        [scaleListeners]
    )

    // Moves the diagram without drawing React again; only the zoom level's readers hear about a new scale.
    const show = useCallback(
        (next: PanZoomState) => {
            const scaleChanged = next.scale !== stateRef.current.scale
            stateRef.current = next
            const el = transformRef.current
            if (el) {
                el.style.transformOrigin = 'center center'
                el.style.transform = toTransform(next)
            }
            if (scaleChanged) for (const onChange of scaleListeners) onChange()
        },
        [transformRef, scaleListeners]
    )

    const applyTransform = useCallback(
        (next: PanZoomState) => {
            show(next)
            const id = tabIdRef.current
            if (id) statesByTab.set(id, next)
        },
        [show, statesByTab]
    )

    useLayoutEffect(() => {
        tabIdRef.current = tabId
        show(tabId ? (statesByTab.get(tabId) ?? DEFAULT_STATE) : DEFAULT_STATE)
    }, [tabId, show, statesByTab])

    useEffect(() => forgetClosedTabs(statesByTab, openTabIds), [statesByTab, openTabIds])

    const reset = useCallback(() => {
        applyTransform(computeCenterTransform())
    }, [applyTransform])

    /** One step in or out, keeping the middle of the view in place, or back to 100%. */
    const zoom = useCallback(
        (how: DiagramZoom) => {
            if (how === 'reset') return reset()
            const prev = stateRef.current
            const scale = how === 'in' ? prev.scale * ZOOM_STEP : prev.scale / ZOOM_STEP
            applyTransform(zoomAround(prev, clampScale(scale, prev.scale), { x: 0, y: 0 }))
        },
        [applyTransform, reset]
    )

    /** Only keys pressed on the canvas itself, not on a button inside it. */
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.target !== e.currentTarget) return
            const gesture = interpretKey(e)
            if (!gesture) return
            e.preventDefault()
            if (gesture.kind === 'zoom') return zoom(gesture.how)
            const prev = stateRef.current
            applyTransform({ ...prev, x: prev.x + gesture.dx, y: prev.y + gesture.dy })
        },
        [applyTransform, zoom]
    )

    const fitToView = useCallback(
        (contentWidth: number, contentHeight: number): boolean => {
            const container = containerRef.current
            if (!container || contentWidth <= 0 || contentHeight <= 0) return false
            const { width, height } = container.getBoundingClientRect()
            if (width <= 0 || height <= 0) return false
            applyTransform(computeFitTransform(width, height, contentWidth, contentHeight))
            return true
        },
        [applyTransform, containerRef]
    )

    const hasViewStateForTab = useCallback((id: string) => statesByTab.has(id), [statesByTab])

    const setGrabbingCursor = useCallback(
        (grabbing: boolean) => {
            const el = containerRef.current
            if (!el) return
            el.classList.toggle('cursor-grabbing', grabbing)
            el.classList.toggle('cursor-grab', !grabbing)
        },
        [containerRef]
    )

    /** Pointer position relative to the container's centre, where the diagram's transform origin sits. */
    const pointFromCenter = useCallback(
        (clientX: number, clientY: number): Point => {
            const rect = containerRef.current?.getBoundingClientRect()
            if (!rect) return { x: clientX, y: clientY }
            return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
        },
        [containerRef]
    )

    /** Starts over from the current view whenever a finger is added or lifted, so the diagram never jumps. */
    const restartGesture = useCallback(() => {
        const [a, b] = pointersRef.current.values()
        if (!a) {
            gestureRef.current = null
            return
        }
        gestureRef.current = b
            ? { start: stateRef.current, origin: midpoint(a, b), distance: distanceBetween(a, b) }
            : { start: stateRef.current, origin: a, distance: 0 }
    }, [])

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            // preventDefault can stop the browser focusing it, and the zoom keys need focus.
            if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus({ preventScroll: true })
            pointersRef.current.set(e.pointerId, pointFromCenter(e.clientX, e.clientY))
            restartGesture()
            setGrabbingCursor(true)
            e.currentTarget.setPointerCapture(e.pointerId)
        },
        [pointFromCenter, restartGesture, setGrabbingCursor]
    )

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!pointersRef.current.has(e.pointerId)) return
            e.preventDefault()
            pointersRef.current.set(e.pointerId, pointFromCenter(e.clientX, e.clientY))

            const gesture = gestureRef.current
            const [a, b] = pointersRef.current.values()
            if (!gesture || !a) return

            if (b && gesture.distance > 0) {
                applyTransform(pinchTransform(gesture.start, gesture.origin, gesture.distance, midpoint(a, b), distanceBetween(a, b)))
                return
            }
            const current = b ? midpoint(a, b) : a
            applyTransform({
                ...gesture.start,
                x: gesture.start.x + current.x - gesture.origin.x,
                y: gesture.start.y + current.y - gesture.origin.y,
            })
        },
        [applyTransform, pointFromCenter]
    )

    const endPan = useCallback(
        (e: React.PointerEvent) => {
            if (!pointersRef.current.delete(e.pointerId)) return
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
            }
            restartGesture()
            if (pointersRef.current.size === 0) setGrabbingCursor(false)
        },
        [restartGesture, setGrabbingCursor]
    )

    // React registers wheel listeners as passive, so preventDefault() there is ignored. A native
    // listener can stop the browser from scrolling or zooming the page while the diagram moves.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const onWheel = (e: WheelEvent) => {
            if (e.target instanceof Element && e.target.closest(`[${NO_CANVAS_GESTURES_ATTRIBUTE}]`)) return
            e.preventDefault()

            const rect = el.getBoundingClientRect()
            const gesture = interpretWheel(e, rect.height)
            const prev = stateRef.current

            if (gesture.kind === 'pan') {
                applyTransform({ ...prev, x: prev.x - gesture.dx, y: prev.y - gesture.dy })
                return
            }
            const point = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
            applyTransform(zoomAround(prev, clampScale(prev.scale * gesture.factor, prev.scale), point))
        }

        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [applyTransform, containerRef])

    return {
        reset,
        zoom,
        zoomLevel,
        fitToView,
        hasViewStateForTab,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endPan,
            onPointerCancel: endPan,
            onLostPointerCapture: endPan,
            onKeyDown,
        },
    }
}
