'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { measureSvgContentBounds, type SvgContentBounds } from '@/lib/mermaid/svg-bounds'

export function svgIframeDocument(svg: string, offsetX = 0, offsetY = 0): string {
    const clip = offsetX !== 0 || offsetY !== 0
    const clipWrapper = clip
        ? `<div style="width:100%;height:100%;overflow:hidden"><div style="transform:translate(${-offsetX}px,${-offsetY}px)">${svg}</div></div>`
        : svg

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:visible;vertical-align:top}
</style></head><body>${clipWrapper}</body></html>`
}

type DiagramIframeProps = {
    svg: string
    bounds: SvgContentBounds | null
    onBoundsMeasured?: (bounds: SvgContentBounds, svg: string) => void
}

type SlotState = { svg: string; loadId: number }

const SWAP_FALLBACK_MS = 80

function slotDimensions(svg: string, clip: SvgContentBounds | null) {
    const base = getSvgDimensions(svg)
    if (!base) return null
    return {
        width: clip?.width ?? base.width,
        height: clip?.height ?? base.height,
        offsetX: clip?.offsetX ?? 0,
        offsetY: clip?.offsetY ?? 0,
    }
}

/** Isolated iframe preview — keeps Mermaid &lt;style&gt;/@import out of the app document. */
export const DiagramIframe = memo(function DiagramIframe({ svg, bounds, onBoundsMeasured }: DiagramIframeProps) {
    const [activeSlot, setActiveSlot] = useState(0)
    const [slots, setSlots] = useState<[SlotState, SlotState]>(() => [
        { svg, loadId: 0 },
        { svg, loadId: 0 },
    ])
    const pendingSlotRef = useRef<number | null>(null)
    const slotsRef = useRef(slots)
    const targetSvgRef = useRef(svg)
    const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    slotsRef.current = slots
    targetSvgRef.current = svg

    const active = slots[activeSlot]
    const activeDims = slotDimensions(active.svg, bounds)
    if (!activeDims) return null

    const clearSwapTimer = useCallback(() => {
        if (swapTimerRef.current !== null) {
            clearTimeout(swapTimerRef.current)
            swapTimerRef.current = null
        }
    }, [])

    const commitSlot = useCallback(
        (slotIndex: number) => {
            const slotSvg = slotsRef.current[slotIndex]?.svg
            if (!slotSvg || slotSvg !== targetSvgRef.current) return
            if (pendingSlotRef.current !== slotIndex) return

            clearSwapTimer()
            pendingSlotRef.current = null
            setActiveSlot(slotIndex)
        },
        [clearSwapTimer]
    )

    const measureSlot = useCallback(
        (slotIndex: number, e: React.SyntheticEvent<HTMLIFrameElement>) => {
            const slotSvg = slotsRef.current[slotIndex]?.svg
            if (!slotSvg || slotSvg !== targetSvgRef.current) return

            const doc = e.currentTarget.contentDocument
            const svgEl = doc?.querySelector('svg')
            if (!svgEl) return

            const measured = measureSvgContentBounds(svgEl)
            const isSwap = pendingSlotRef.current === slotIndex
            if (isSwap) commitSlot(slotIndex)

            if (measured && (isSwap || slotIndex === activeSlot)) {
                onBoundsMeasured?.(measured, slotSvg)
            }
        },
        [activeSlot, commitSlot, onBoundsMeasured]
    )

    useEffect(() => {
        setSlots((prev) => {
            if (svg === prev[activeSlot].svg) return prev

            const inactive = 1 - activeSlot
            pendingSlotRef.current = inactive
            clearSwapTimer()

            swapTimerRef.current = setTimeout(() => commitSlot(inactive), SWAP_FALLBACK_MS)

            const next = [...prev] as [SlotState, SlotState]
            next[inactive] = { svg, loadId: prev[inactive].loadId + 1 }
            return next
        })
    }, [svg, activeSlot, clearSwapTimer, commitSlot])

    useEffect(() => () => clearSwapTimer(), [clearSwapTimer])

    return (
        <div className="relative overflow-hidden" style={{ width: activeDims.width, height: activeDims.height }}>
            {([0, 1] as const).map((slotIndex) => {
                const slot = slots[slotIndex]
                const isActive = slotIndex === activeSlot
                const clip = isActive ? bounds : null
                const dims = slotDimensions(slot.svg, clip)
                if (!dims) return null

                return (
                    <iframe
                        key={`${slotIndex}-${slot.loadId}`}
                        title="Diagram preview"
                        className="pointer-events-none absolute top-0 left-0 overflow-hidden border-0 bg-transparent"
                        sandbox=""
                        srcDoc={svgIframeDocument(slot.svg, dims.offsetX, dims.offsetY)}
                        onLoad={(e) => measureSlot(slotIndex, e)}
                        style={{
                            width: dims.width,
                            height: dims.height,
                            background: 'transparent',
                            colorScheme: 'normal',
                            overflow: 'hidden',
                            opacity: isActive ? 1 : 0,
                            zIndex: isActive ? 1 : 0,
                        }}
                    />
                )
            })}
        </div>
    )
})
