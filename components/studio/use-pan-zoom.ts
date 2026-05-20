'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.001
const FIT_PADDING = 48

export function computeFitTransform(
    containerWidth: number,
    containerHeight: number,
    contentWidth: number,
    contentHeight: number,
    padding = FIT_PADDING
): PanZoomState {
    const availableW = Math.max(0, containerWidth - padding * 2)
    const availableH = Math.max(0, containerHeight - padding * 2)
    const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(availableW / contentWidth, availableH / contentHeight))
    )
    return { x: 0, y: 0, scale }
}

export type PanZoomState = {
    x: number
    y: number
    scale: number
}

export function getSvgDimensions(svg: string): { width: number; height: number } | null {
    const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i)
    if (viewBoxMatch) {
        const parts = viewBoxMatch[1]
            .trim()
            .split(/[\s,]+/)
            .map(Number)
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] }
        }
    }

    const widthMatch = svg.match(/\bwidth=["']([^"']+)["']/i)
    const heightMatch = svg.match(/\bheight=["']([^"']+)["']/i)
    if (widthMatch && heightMatch) {
        const width = parseFloat(widthMatch[1])
        const height = parseFloat(heightMatch[1])
        if (width > 0 && height > 0) {
            return { width, height }
        }
    }

    return null
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
        if (el) el.style.transform = toTransform(next)
    }, [tabId, transformRef])

    useEffect(() => {
        const open = new Set(openTabIds)
        for (const key of statesByTabRef.current.keys()) {
            if (!open.has(key)) statesByTabRef.current.delete(key)
        }
    }, [openTabIds])

    const reset = useCallback(() => {
        applyTransform(DEFAULT_STATE)
    }, [applyTransform])

    const fitToView = useCallback(
        (contentWidth: number, contentHeight: number) => {
            const container = containerRef.current
            if (!container || contentWidth <= 0 || contentHeight <= 0) return
            const { width, height } = container.getBoundingClientRect()
            applyTransform(computeFitTransform(width, height, contentWidth, contentHeight))
        },
        [applyTransform, containerRef]
    )

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
        fitToView,
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
