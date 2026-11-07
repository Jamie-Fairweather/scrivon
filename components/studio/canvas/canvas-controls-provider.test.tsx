import { act, render, screen } from '@testing-library/react'
import { memo, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CanvasControlsProvider, useCanvasControls } from './canvas-controls-provider'

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
})
