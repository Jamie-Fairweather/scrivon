'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001
const FIT_PADDING = 24

export function computeFitTransform(
    containerWidth: number,
    containerHeight: number,
    contentWidth: number,
    contentHeight: number,
    padding = FIT_PADDING
): PanZoomState {
    const availableW = Math.max(0, containerWidth - padding * 2)
    const availableH = Math.max(0, containerHeight - padding * 2)
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availableW / contentWidth, availableH / contentHeight)))
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

function toTransform({ x, y, scale }: PanZoomState) {
    return `translate(${x}px, ${y}px) scale(${scale})`
}

const DEFAULT_STATE: PanZoomState = { x: 0, y: 0, scale: 1 }

export function usePanZoom(
    containerRef: RefObject<HTMLElement | null>,
    transformRef: RefObject<HTMLElement | null>,
    tabId: string | null,
    openTabIds: string[] = []
) {
    const stateRef = useRef<PanZoomState>(DEFAULT_STATE)
    const statesByTabRef = useRef(new Map<string, PanZoomState>())
    const tabIdRef = useRef(tabId)
    const isPanningRef = useRef(false)
    const panStart = useRef({ x: 0, y: 0, stateX: 0, stateY: 0 })

    const applyTransform = useCallback(
        (next: PanZoomState) => {
            stateRef.current = next
            const el = transformRef.current
            if (el) {
                el.style.transformOrigin = 'center center'
                el.style.transform = toTransform(next)
            }
            const id = tabIdRef.current
            if (id) statesByTabRef.current.set(id, next)
        },
        [transformRef]
    )

    useLayoutEffect(() => {
        tabIdRef.current = tabId
        const next = tabId ? (statesByTabRef.current.get(tabId) ?? DEFAULT_STATE) : DEFAULT_STATE
        stateRef.current = next
        const el = transformRef.current
        if (el) {
            el.style.transformOrigin = 'center center'
            el.style.transform = toTransform(next)
        }
    }, [tabId, transformRef])

    useEffect(() => {
        const open = new Set(openTabIds)
        for (const key of statesByTabRef.current.keys()) {
            if (!open.has(key)) statesByTabRef.current.delete(key)
        }
    }, [openTabIds])

    const reset = useCallback(() => {
        applyTransform(computeCenterTransform())
    }, [applyTransform])

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

    const hasViewStateForTab = useCallback((id: string) => statesByTabRef.current.has(id), [])

    const setGrabbingCursor = useCallback(
        (grabbing: boolean) => {
            const el = containerRef.current
            if (!el) return
            el.classList.toggle('cursor-grabbing', grabbing)
            el.classList.toggle('cursor-grab', !grabbing)
        },
        [containerRef]
    )

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            isPanningRef.current = true
            setGrabbingCursor(true)
            panStart.current = {
                x: e.clientX,
                y: e.clientY,
                stateX: stateRef.current.x,
                stateY: stateRef.current.y,
            }
            e.currentTarget.setPointerCapture(e.pointerId)
        },
        [setGrabbingCursor]
    )

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!isPanningRef.current) return
            e.preventDefault()
            const dx = e.clientX - panStart.current.x
            const dy = e.clientY - panStart.current.y
            applyTransform({
                ...stateRef.current,
                x: panStart.current.stateX + dx,
                y: panStart.current.stateY + dy,
            })
        },
        [applyTransform]
    )

    const endPan = useCallback(
        (e: React.PointerEvent) => {
            if (!isPanningRef.current) return
            isPanningRef.current = false
            setGrabbingCursor(false)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId)
            }
        },
        [setGrabbingCursor]
    )

    const onWheel = useCallback(
        (e: React.WheelEvent) => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const cursorX = e.clientX - rect.left
            const cursorY = e.clientY - rect.top
            const centerX = rect.width / 2
            const centerY = rect.height / 2
            const prev = stateRef.current

            const delta = -e.deltaY * ZOOM_SENSITIVITY
            const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + delta)))
            const contentX = (cursorX - centerX - prev.x) / prev.scale
            const contentY = (cursorY - centerY - prev.y) / prev.scale

            applyTransform({
                x: cursorX - centerX - contentX * nextScale,
                y: cursorY - centerY - contentY * nextScale,
                scale: nextScale,
            })
        },
        [applyTransform]
    )

    return {
        reset,
        fitToView,
        hasViewStateForTab,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endPan,
            onPointerCancel: endPan,
            onLostPointerCapture: endPan,
            onWheel,
        },
    }
}
