import { act, render, screen } from '@testing-library/react'
import { memo, useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasControlsProvider, GroupCanvasControlsProvider, useCanvasControls } from './canvas-controls-provider'

describe('CanvasControlsProvider', () => {
    it('does not draw its consumers again when only the component around it draws again', () => {
        let renders = 0
        let controls: ReturnType<typeof useCanvasControls> | null = null
        // Memoized, so only a change in what the provider hands out can draw it again.
        const Consumer = memo(function Consumer() {
            controls = useCanvasControls()
            renders += 1
            return <span>{controls.canFitToView ? 'can fit' : 'cannot fit'}</span>
        })
        let drawAgain = () => {}
        // Stands in for WorkspaceProvider, which draws again on every keystroke.
        function Parent() {
            const [count, setCount] = useState(0)
            drawAgain = () => setCount((c) => c + 1)
            return (
                <CanvasControlsProvider>
                    <span data-testid="count">{count}</span>
                    <Consumer />
                </CanvasControlsProvider>
            )
        }

        render(<Parent />)
        expect(renders).toBe(1)

        act(() => drawAgain())
        act(() => drawAgain())
        expect(screen.getByTestId('count')).toHaveTextContent('2')
        expect(renders).toBe(1)

        // It still draws again when what it shows changes.
        act(() => controls!.setCanFitToView(true))
        expect(renders).toBe(2)
        expect(screen.getByText('can fit')).toBeInTheDocument()
    })

    it('zooms the diagram on screen, and does nothing once that canvas has gone (F06)', () => {
        let controls: ReturnType<typeof useCanvasControls> | null = null
        function Consumer() {
            controls = useCanvasControls()
            return null
        }
        render(
            <CanvasControlsProvider>
                <Consumer />
            </CanvasControlsProvider>
        )
        const zoom = vi.fn()

        const unregister = controls!.registerZoomDiagram(zoom)
        controls!.zoomDiagram('in')
        controls!.zoomDiagram('reset')
        expect(zoom.mock.calls).toEqual([['in'], ['reset']])

        unregister()
        controls!.zoomDiagram('out')
        expect(zoom).toHaveBeenCalledTimes(2)
    })
})

describe('GroupCanvasControlsProvider', () => {
    /** Stands in for a group's diagram canvas: hands its group its fit and zoom, and says whether it can fit. */
    function Canvas({ fit, zoom, canFit }: { fit: () => void; zoom: (how: string) => void; canFit: boolean }) {
        const { registerFitToView, registerZoomDiagram, setCanFitToView } = useCanvasControls()
        useEffect(() => registerFitToView(fit), [registerFitToView, fit])
        useEffect(() => registerZoomDiagram(zoom), [registerZoomDiagram, zoom])
        useEffect(() => setCanFitToView(canFit), [setCanFitToView, canFit])
        return null
    }

    let app: ReturnType<typeof useCanvasControls> | null = null
    function AppControls() {
        app = useCanvasControls()
        return null
    }

    const left = { fit: vi.fn(), zoom: vi.fn() }
    const right = { fit: vi.fn(), zoom: vi.fn() }
    /** Two groups as the split editor lays them out: the left with a diagram that can fit, the right with one that can't yet. */
    function Split({ focused, rightCanFit = false, rightShown = true }: { focused: number; rightCanFit?: boolean; rightShown?: boolean }) {
        return (
            <CanvasControlsProvider>
                <AppControls />
                <GroupCanvasControlsProvider focused={focused === 0}>
                    <Canvas fit={left.fit} zoom={left.zoom} canFit />
                </GroupCanvasControlsProvider>
                {rightShown ? (
                    <GroupCanvasControlsProvider focused={focused === 1}>
                        <Canvas fit={right.fit} zoom={right.zoom} canFit={rightCanFit} />
                    </GroupCanvasControlsProvider>
                ) : null}
            </CanvasControlsProvider>
        )
    }

    it('sends the app’s Fit Diagram and zoom to the focused group’s canvas only, and follows the focus', () => {
        for (const spy of [left.fit, left.zoom, right.fit, right.zoom]) spy.mockClear()
        const view = render(<Split focused={1} />)

        // The right group's diagram can't fit yet, so the app's Fit Diagram is off though the left one could.
        expect(app!.canFitToView).toBe(false)
        act(() => app!.fitToView())
        act(() => app!.zoomDiagram('in'))
        expect(right.fit).toHaveBeenCalledOnce()
        expect(right.zoom).toHaveBeenCalledExactlyOnceWith('in')
        expect(left.fit).not.toHaveBeenCalled()
        expect(left.zoom).not.toHaveBeenCalled()

        view.rerender(<Split focused={1} rightCanFit />)
        expect(app!.canFitToView).toBe(true)

        // The left group gets the keyboard: the app's controls move to its canvas.
        view.rerender(<Split focused={0} />)
        expect(app!.canFitToView).toBe(true)
        act(() => app!.fitToView())
        act(() => app!.zoomDiagram('reset'))
        expect(left.fit).toHaveBeenCalledOnce()
        expect(left.zoom).toHaveBeenCalledExactlyOnceWith('reset')
        expect(right.fit).toHaveBeenCalledOnce()
        expect(right.zoom).toHaveBeenCalledOnce()

        // And back, to a diagram that can't fit.
        view.rerender(<Split focused={1} />)
        expect(app!.canFitToView).toBe(false)
    })

    it('leaves the app with no diagram controls when the focused group goes, until another group has the keyboard', () => {
        for (const spy of [left.fit, left.zoom, right.fit, right.zoom]) spy.mockClear()
        const view = render(<Split focused={1} rightCanFit />)
        expect(app!.canFitToView).toBe(true)

        // The right group closes; for that render no group has the keyboard yet.
        view.rerender(<Split focused={1} rightShown={false} />)
        expect(app!.canFitToView).toBe(false)
        act(() => app!.fitToView())
        act(() => app!.zoomDiagram('out'))
        expect(right.fit).not.toHaveBeenCalled()
        expect(right.zoom).not.toHaveBeenCalled()
        expect(left.fit).not.toHaveBeenCalled()

        // Focus moves to the group that is left.
        view.rerender(<Split focused={0} rightShown={false} />)
        expect(app!.canFitToView).toBe(true)
        act(() => app!.fitToView())
        expect(left.fit).toHaveBeenCalledOnce()
    })
})
