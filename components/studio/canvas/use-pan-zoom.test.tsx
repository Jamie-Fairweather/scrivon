import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { clampScale, interpretWheel, pinchTransform, usePanZoom, zoomAround, type WheelInput } from '@/components/studio/canvas/use-pan-zoom'

function wheel(input: Partial<WheelInput>): WheelInput {
    return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...input }
}

describe('interpretWheel', () => {
    it('pans for two-finger touchpad scrolling, in both directions', () => {
        expect(interpretWheel(wheel({ deltaY: 12.5, wheelDeltaY: -15 }), 600)).toEqual({ kind: 'pan', dx: 0, dy: 12.5 })
        expect(interpretWheel(wheel({ deltaX: -30, deltaY: 4, wheelDeltaY: -4 }), 600)).toEqual({ kind: 'pan', dx: -30, dy: 4 })
    })

    it('still zooms for a mouse wheel notch, about 10% per notch, the same amount in and out', () => {
        const out = interpretWheel(wheel({ deltaY: 100, wheelDeltaY: -120 }), 600)
        const inward = interpretWheel(wheel({ deltaY: -100, wheelDeltaY: 120 }), 600)
        expect(out).toEqual({ kind: 'zoom', factor: expect.closeTo(0.905, 3) })
        expect(inward).toEqual({ kind: 'zoom', factor: expect.closeTo(1.105, 3) })
        if (out.kind === 'zoom' && inward.kind === 'zoom') expect(out.factor * inward.factor).toBeCloseTo(1, 10)
    })

    it('tells notches from touchpads without wheelDeltaY, and treats line units as a mouse', () => {
        expect(interpretWheel(wheel({ deltaY: 120 }), 600).kind).toBe('zoom')
        expect(interpretWheel(wheel({ deltaY: 7 }), 600).kind).toBe('pan')
        expect(interpretWheel(wheel({ deltaY: 3, deltaMode: 1 }), 600)).toEqual({ kind: 'zoom', factor: expect.closeTo(Math.exp(-0.048), 6) })
    })

    it('pans sideways for Shift+wheel, which arrives as deltaX', () => {
        expect(interpretWheel(wheel({ deltaX: 100, wheelDeltaY: 0 }), 600)).toEqual({ kind: 'pan', dx: 100, dy: 0 })
    })

    it('zooms for a touchpad pinch (ctrl+wheel) at the pinch rate', () => {
        expect(interpretWheel(wheel({ deltaY: -10, ctrlKey: true, wheelDeltaY: 0 }), 600)).toEqual({
            kind: 'zoom',
            factor: expect.closeTo(Math.exp(0.1), 6),
        })
        expect(interpretWheel(wheel({ deltaY: 100, ctrlKey: true, wheelDeltaY: -120 }), 600)).toEqual({
            kind: 'zoom',
            factor: expect.closeTo(0.905, 3),
        })
    })

    it('never gives a zero or negative zoom for huge page-scroll deltas', () => {
        const gesture = interpretWheel(wheel({ deltaY: 3, deltaMode: 2 }), 900)
        expect(gesture.kind).toBe('zoom')
        if (gesture.kind === 'zoom') expect(gesture.factor).toBeGreaterThan(0)
    })
})

describe('zoom helpers', () => {
    it('keeps the point under the cursor in place', () => {
        const prev = { x: 10, y: -20, scale: 1 }
        const next = zoomAround(prev, 2, { x: 50, y: 30 })
        expect(next.scale).toBe(2)
        expect((50 - prev.x) / prev.scale).toBeCloseTo((50 - next.x) / next.scale)
        expect((30 - prev.y) / prev.scale).toBeCloseTo((30 - next.y) / next.scale)
    })

    it('clamps the scale without snapping an out-of-range view', () => {
        expect(clampScale(100, 1)).toBe(5)
        expect(clampScale(0.5, 0.01)).toBe(0.5)
        expect(clampScale(0.005, 0.01)).toBe(0.01)
    })

    it('pinch scales by the finger spread and follows the midpoint', () => {
        const start = { x: 0, y: 0, scale: 1 }
        expect(pinchTransform(start, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200)).toEqual({ x: 0, y: 0, scale: 2 })
        expect(pinchTransform(start, { x: 0, y: 0 }, 100, { x: 15, y: -5 }, 100)).toEqual({ x: 15, y: -5, scale: 1 })
    })
})

function Canvas() {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const { handlers } = usePanZoom(containerRef, transformRef, 'a.mmd', ['a.mmd'])
    return (
        <div ref={containerRef} data-testid="container" {...handlers}>
            <div ref={transformRef} data-testid="content" />
            <div data-canvas-no-gestures>
                <pre data-testid="banner">error</pre>
            </div>
        </div>
    )
}

function dispatchWheel(
    target: Element,
    { deltaX = 0, deltaY = 0, ...extra }: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; wheelDeltaY?: number }
) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY })
    // happy-dom's WheelEvent has no mouse fields, so set the ones the handler reads.
    for (const [key, value] of Object.entries({ clientX: 0, clientY: 0, ctrlKey: false, metaKey: false, ...extra })) {
        Object.defineProperty(event, key, { value })
    }
    target.dispatchEvent(event)
    return event
}

describe('usePanZoom', () => {
    it('pans on a touchpad scroll and blocks the page from scrolling or zooming', () => {
        const { getByTestId } = render(<Canvas />)
        const event = dispatchWheel(getByTestId('container'), { deltaX: 5, deltaY: 40, wheelDeltaY: -40 })

        expect(event.defaultPrevented).toBe(true)
        expect(getByTestId('content').style.transform).toBe('translate(-5px, -40px) scale(1)')
    })

    it('zooms on a pinch', () => {
        const { getByTestId } = render(<Canvas />)
        dispatchWheel(getByTestId('container'), { deltaY: -100 * Math.log(2), ctrlKey: true, wheelDeltaY: 0 })

        const scale = Number(/scale\(([\d.]+)\)$/.exec(getByTestId('content').style.transform)?.[1])
        expect(scale).toBeCloseTo(2, 10)
    })

    it('leaves wheel events over the error banner to the browser', () => {
        const { getByTestId } = render(<Canvas />)
        const event = dispatchWheel(getByTestId('banner'), { deltaY: 40, wheelDeltaY: -40 })

        expect(event.defaultPrevented).toBe(false)
        expect(getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('pinches with two fingers and does not jump when one finger lifts', () => {
        const { getByTestId } = render(<Canvas />)
        const container = getByTestId('container')
        const content = getByTestId('content')

        fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
        fireEvent.pointerDown(container, { pointerId: 2, button: 0, clientX: 100, clientY: 0 })
        fireEvent.pointerMove(container, { pointerId: 2, clientX: 200, clientY: 0 })
        expect(content.style.transform).toBe('translate(0px, 0px) scale(2)')

        fireEvent.pointerUp(container, { pointerId: 2, clientX: 200, clientY: 0 })
        expect(content.style.transform).toBe('translate(0px, 0px) scale(2)')

        fireEvent.pointerMove(container, { pointerId: 1, clientX: 10, clientY: 20 })
        expect(content.style.transform).toBe('translate(10px, 20px) scale(2)')
    })

    it('still pans with a mouse drag', () => {
        const { getByTestId } = render(<Canvas />)
        const container = getByTestId('container')

        fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 10, clientY: 10 })
        fireEvent.pointerMove(container, { pointerId: 1, clientX: 40, clientY: -10 })
        fireEvent.pointerUp(container, { pointerId: 1, clientX: 40, clientY: -10 })
        fireEvent.pointerMove(container, { pointerId: 1, clientX: 90, clientY: 90 })

        expect(getByTestId('content').style.transform).toBe('translate(30px, -20px) scale(1)')
    })
})
