'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001

export type PanZoomState = {
    x: number
    y: number
    scale: number
}

type BaseSize = { w: number; h: number }

function toTranslate({ x, y }: { x: number; y: number }) {
    return `translate(${x}px, ${y}px)`
}

export function usePanZoom(
    containerRef: RefObject<HTMLElement | null>,
    transformRef: RefObject<HTMLElement | null>,
    initial: PanZoomState = { x: 0, y: 0, scale: 1 }
) {
    const stateRef = useRef(initial)
    const baseSizeRef = useRef<BaseSize | null>(null)
    const isPanningRef = useRef(false)
    const panStart = useRef({ x: 0, y: 0, stateX: 0, stateY: 0 })

    const applySvgScale = useCallback(
        (scale: number) => {
            const base = baseSizeRef.current
            const svg = transformRef.current?.querySelector('svg')
            if (!base || !svg) return
            svg.setAttribute('width', String(base.w * scale))
            svg.setAttribute('height', String(base.h * scale))
        },
        [transformRef]
    )

    const applyTransform = useCallback(
        (next: PanZoomState) => {
            stateRef.current = next
            const el = transformRef.current
            if (el) {
                el.style.transform = toTranslate(next)
            }
            applySvgScale(next.scale)
        },
        [transformRef, applySvgScale]
    )

    const refreshBaseSize = useCallback(() => {
        const svg = transformRef.current?.querySelector('svg')
        if (!svg) return
        const { width, height } = svg.viewBox.baseVal
        if (width <= 0 || height <= 0) return
        baseSizeRef.current = { w: width, h: height }
        applyTransform(stateRef.current)
    }, [transformRef, applyTransform])

    useEffect(() => {
        applyTransform(stateRef.current)
    }, [applyTransform])

    const reset = useCallback(() => {
        applyTransform(initial)
    }, [applyTransform, initial.x, initial.y, initial.scale])

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
            const prev = stateRef.current

            const delta = -e.deltaY * ZOOM_SENSITIVITY
            const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + delta)))
            const scaleRatio = nextScale / prev.scale

            // Diagram is flex-centered; pan offsets the center from viewport center.
            // Keep the point under the cursor fixed while scaling SVG width/height.
            const centerX = rect.width / 2
            const centerY = rect.height / 2

            applyTransform({
                x: cursorX - centerX - (cursorX - centerX - prev.x) * scaleRatio,
                y: cursorY - centerY - (cursorY - centerY - prev.y) * scaleRatio,
                scale: nextScale,
            })
        },
        [applyTransform]
    )

    return {
        reset,
        refreshBaseSize,
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
