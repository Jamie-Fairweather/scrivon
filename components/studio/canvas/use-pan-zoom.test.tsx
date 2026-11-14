import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import {
    clampScale,
    computeFitTransform,
    interpretWheel,
    pinchTransform,
    usePanZoom,
    usePanZoomMemory,
    zoomAround,
    type PanZoomMemory,
    type WheelInput,
} from '@/components/studio/canvas/use-pan-zoom'

describe('computeFitTransform', () => {
    it('does not blow a tiny diagram up past 150%', () => {
        expect(computeFitTransform(800, 600, 140, 117).scale).toBe(1.5)
    })

    it('shrinks a very wide diagram below 10% so it fits', () => {
        const { scale } = computeFitTransform(600, 600, 7000, 300)
        expect(scale).toBeCloseTo((600 - 48) / 7000, 6)
        expect(7000 * scale).toBeLessThanOrEqual(600 - 48)
    })

    it('leaves a mid-size diagram at its natural fit', () => {
        expect(computeFitTransform(800, 600, 1504, 400).scale).toBeCloseTo(0.5, 6)
    })
})

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
        expect(clampScale(0.03, 0.05)).toBe(0.03)
        expect(clampScale(0.001, 0.05)).toBe(0.02)
        expect(clampScale(0.5, 0.01)).toBe(0.5)
        expect(clampScale(0.005, 0.01)).toBe(0.01)
    })

    it('pinch scales by the finger spread and follows the midpoint', () => {
        const start = { x: 0, y: 0, scale: 1 }
        expect(pinchTransform(start, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200)).toEqual({ x: 0, y: 0, scale: 2 })
        expect(pinchTransform(start, { x: 0, y: 0 }, 100, { x: 15, y: -5 }, 100)).toEqual({ x: 15, y: -5, scale: 1 })
    })
})

type PanZoom = ReturnType<typeof usePanZoom>

function Canvas({ tabId = 'a.mmd', memory, onPanZoom }: { tabId?: string; memory?: PanZoomMemory; onPanZoom?: (panZoom: PanZoom) => void }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const panZoom = usePanZoom(containerRef, transformRef, tabId, ['a.mmd', 'b.mmd'], memory)
    onPanZoom?.(panZoom)
    const { handlers } = panZoom
    return (
        <div ref={containerRef} data-testid="container" {...handlers}>
            <div ref={transformRef} data-testid="content" />
            <div data-canvas-no-gestures>
                <pre data-testid="banner">error</pre>
            </div>
            <input data-testid="field" aria-label="Field" />
            <div data-testid="editable" contentEditable suppressContentEditableWarning />
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

    it('zooms in and out by one step around the middle, and back to 100% (F06)', () => {
        let panZoom!: PanZoom
        const { getByTestId } = render(<Canvas onPanZoom={(p) => (panZoom = p)} />)
        const content = getByTestId('content')
        dispatchWheel(getByTestId('container'), { deltaY: 40, wheelDeltaY: -40 })

        act(() => panZoom.zoom('in'))
        expect(content.style.transform).toBe('translate(0px, -50px) scale(1.25)')

        act(() => panZoom.zoom('out'))
        expect(content.style.transform).toBe('translate(0px, -40px) scale(1)')

        act(() => panZoom.zoom('out'))
        expect(content.style.transform).toBe('translate(0px, -32px) scale(0.8)')

        act(() => panZoom.zoom('reset'))
        expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('zooms with + - and 0, and moves the diagram with the arrow keys, while the canvas has focus (F06)', () => {
        const { getByTestId } = render(<Canvas />)
        const container = getByTestId('container')
        const content = getByTestId('content')

        expect(fireEvent.keyDown(container, { key: '+' })).toBe(false)
        expect(content.style.transform).toBe('translate(0px, 0px) scale(1.25)')
        fireEvent.keyDown(container, { key: '-' })
        fireEvent.keyDown(container, { key: '=' })
        fireEvent.keyDown(container, { key: '_' })
        expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')

        // Like scrolling: Right shows more of the right side, Shift moves further.
        fireEvent.keyDown(container, { key: 'ArrowRight' })
        fireEvent.keyDown(container, { key: 'ArrowDown', shiftKey: true })
        expect(content.style.transform).toBe('translate(-50px, -200px) scale(1)')
        fireEvent.keyDown(container, { key: 'ArrowLeft' })
        fireEvent.keyDown(container, { key: 'ArrowUp' })
        expect(content.style.transform).toBe('translate(0px, -150px) scale(1)')

        // Ctrl with + - 0 too, so the focused diagram's zoom wins over zooming the app.
        fireEvent.keyDown(container, { key: '=', ctrlKey: true })
        expect(content.style.transform).toBe('translate(0px, -187.5px) scale(1.25)')
        fireEvent.keyDown(container, { key: '0' })
        expect(content.style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('leaves other keys and Alt shortcuts alone', () => {
        const { getByTestId } = render(<Canvas />)
        const container = getByTestId('container')

        expect(fireEvent.keyDown(container, { key: 'a' })).toBe(true)
        expect(fireEvent.keyDown(container, { key: '=', altKey: true })).toBe(true)
        expect(fireEvent.keyDown(container, { key: '=', ctrlKey: true, altKey: true })).toBe(true)
        expect(fireEvent.keyDown(container, { key: 'ArrowLeft', ctrlKey: true })).toBe(true)
        expect(getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('zooms with keys pressed on something inside the canvas, but leaves it the arrow keys (#178)', () => {
        const { getByTestId } = render(<Canvas />)
        const banner = getByTestId('banner')

        expect(fireEvent.keyDown(banner, { key: '+' })).toBe(false)
        expect(getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1.25)')
        // The arrow keys scroll the message, or move between buttons.
        expect(fireEvent.keyDown(banner, { key: 'ArrowDown' })).toBe(true)
        expect(getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1.25)')
    })

    it('leaves every key to a text field inside the canvas (#178)', () => {
        const { getByTestId } = render(<Canvas />)

        expect(fireEvent.keyDown(getByTestId('field'), { key: '-' })).toBe(true)
        expect(fireEvent.keyDown(getByTestId('field'), { key: '0', ctrlKey: true })).toBe(true)
        expect(fireEvent.keyDown(getByTestId('editable'), { key: '+' })).toBe(true)
        expect(getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('keeps each view in the given memory, so a canvas mounted again shows it as it was left (N05)', () => {
        const memory: PanZoomMemory = new Map()
        const first = render(<Canvas memory={memory} />)
        dispatchWheel(first.getByTestId('container'), { deltaX: 5, deltaY: 40, wheelDeltaY: -40 })
        first.unmount()

        const again = render(<Canvas memory={memory} />)
        expect(again.getByTestId('content').style.transform).toBe('translate(-5px, -40px) scale(1)')

        again.rerender(<Canvas memory={memory} tabId="b.mmd" />)
        expect(again.getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1)')
    })

    it('forgets the view when the canvas goes away and has no memory of its own', () => {
        const first = render(<Canvas />)
        dispatchWheel(first.getByTestId('container'), { deltaX: 5, deltaY: 40, wheelDeltaY: -40 })
        first.unmount()

        expect(render(<Canvas />).getByTestId('content').style.transform).toBe('translate(0px, 0px) scale(1)')
    })
})

describe('usePanZoomMemory', () => {
    it('forgets the view of a tab that closed, so the file is fitted afresh when it opens again (N05)', () => {
        const view = renderHook(({ openTabIds }) => usePanZoomMemory(openTabIds), { initialProps: { openTabIds: ['a.mmd', 'b.mmd'] } })
        const memory = view.result.current
        memory.set('a.mmd', { x: 1, y: 2, scale: 3 })
        memory.set('b.mmd', { x: 4, y: 5, scale: 6 })

        view.rerender({ openTabIds: ['a.mmd'] })

        expect(view.result.current).toBe(memory)
        expect([...memory.keys()]).toEqual(['a.mmd'])
    })
})
