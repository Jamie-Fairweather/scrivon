import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CanvasFitProvider, GroupCanvasFitProvider, useCanvasFit } from './canvas-fit-context'

describe('GroupCanvasFitProvider', () => {
    // The fit request number each group's canvas sees; a canvas fits its diagram each time its number goes up.
    const seen: Record<string, number> = {}
    let app: ReturnType<typeof useCanvasFit> | null = null
    function AppFit() {
        app = useCanvasFit()
        return null
    }
    function Canvas({ name }: { name: string }) {
        seen[name] = useCanvasFit().canvasFitRequestId
        return null
    }
    function Split({ focused }: { focused: number }) {
        return (
            <CanvasFitProvider>
                <AppFit />
                <GroupCanvasFitProvider focused={focused === 0}>
                    <Canvas name="left" />
                </GroupCanvasFitProvider>
                <GroupCanvasFitProvider focused={focused === 1}>
                    <Canvas name="right" />
                </GroupCanvasFitProvider>
            </CanvasFitProvider>
        )
    }

    it('fits only the focused group’s diagram for each request, and follows the focus', () => {
        const view = render(<Split focused={1} />)
        const start = { ...seen }

        act(() => app!.requestCanvasFit())
        expect(seen.right).toBe(start.right! + 1)
        expect(seen.left).toBe(start.left)

        view.rerender(<Split focused={0} />)
        // Moving the focus is not a request.
        expect(seen).toEqual({ left: start.left, right: start.right! + 1 })

        act(() => app!.requestCanvasFit())
        act(() => app!.requestCanvasFit())
        expect(seen.left).toBe(start.left! + 2)
        expect(seen.right).toBe(start.right! + 1)
    })

    it('asks the app for a fit from a group, which the focused group then does', () => {
        let rightGroup: ReturnType<typeof useCanvasFit> | null = null
        function RightFitButton() {
            rightGroup = useCanvasFit()
            return null
        }
        render(
            <CanvasFitProvider>
                <AppFit />
                <GroupCanvasFitProvider focused={false}>
                    <Canvas name="left" />
                </GroupCanvasFitProvider>
                <GroupCanvasFitProvider focused>
                    <Canvas name="right" />
                    <RightFitButton />
                </GroupCanvasFitProvider>
            </CanvasFitProvider>
        )
        const start = { ...seen }

        act(() => rightGroup!.requestCanvasFit())
        expect(seen.right).toBe(start.right! + 1)
        expect(seen.left).toBe(start.left)
    })
})
