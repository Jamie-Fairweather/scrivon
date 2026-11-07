import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanvasFitOnFirstView, useCanvasFitOnRequest } from '@/components/studio/canvas/use-canvas-fit-on-load'

type Size = { width: number; height: number } | null

const SIZE = { width: 100, height: 50 }

type FitProps = { requestId: number; viewKey: string | null; dimensions: Size }

function renderFitOnRequest(initialProps: FitProps) {
    const fitToView = vi.fn(() => true)
    const view = renderHook(({ requestId, viewKey, dimensions }: FitProps) => useCanvasFitOnRequest(requestId, viewKey, dimensions, fitToView), {
        initialProps,
    })
    return { ...view, fitToView }
}

describe('useCanvasFitOnRequest', () => {
    it('fits once for each new request', () => {
        const { rerender, fitToView } = renderFitOnRequest({ requestId: 0, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).not.toHaveBeenCalled()

        rerender({ requestId: 1, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).toHaveBeenCalledTimes(1)
        rerender({ requestId: 1, viewKey: 'a.mmd', dimensions: { width: 200, height: 50 } })
        expect(fitToView).toHaveBeenCalledTimes(1)
    })

    it('keeps a request open until there is a diagram to fit', () => {
        const { rerender, fitToView } = renderFitOnRequest({ requestId: 0, viewKey: 'a.mmd', dimensions: null })

        rerender({ requestId: 1, viewKey: 'a.mmd', dimensions: null })
        expect(fitToView).not.toHaveBeenCalled()
        rerender({ requestId: 1, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).toHaveBeenCalledWith(100, 50)
    })

    it('leaves alone a request made before the canvas mounted, so coming back to a diagram keeps its zoom (N05)', () => {
        const { rerender, fitToView } = renderFitOnRequest({ requestId: 3, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).not.toHaveBeenCalled()

        rerender({ requestId: 4, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).toHaveBeenCalledTimes(1)
    })

    it('drops a request for a diagram that never drew once another tab shows, so that tab keeps its zoom (N17)', () => {
        const { rerender, fitToView } = renderFitOnRequest({ requestId: 0, viewKey: 'a.mmd', dimensions: SIZE })

        // B.mmd opened with a syntax error: nothing to fit yet.
        rerender({ requestId: 1, viewKey: 'b.mmd', dimensions: null })
        // Back to A, which draws straight away.
        rerender({ requestId: 1, viewKey: 'a.mmd', dimensions: SIZE })
        expect(fitToView).not.toHaveBeenCalled()

        // Fitting B the first time it draws is useCanvasFitOnFirstView's job.
        rerender({ requestId: 1, viewKey: 'b.mmd', dimensions: SIZE })
        expect(fitToView).not.toHaveBeenCalled()
    })

    it('still fits a diagram that draws a moment after the request, while it shows (N17)', () => {
        const { rerender, fitToView } = renderFitOnRequest({ requestId: 0, viewKey: 'a.mmd', dimensions: SIZE })

        rerender({ requestId: 1, viewKey: 'b.mmd', dimensions: null })
        rerender({ requestId: 1, viewKey: 'b.mmd', dimensions: SIZE })

        expect(fitToView).toHaveBeenCalledTimes(1)
    })
})

describe('useCanvasFitOnFirstView', () => {
    it('fits a tab the first time its diagram shows, unless it already has a view', () => {
        const fitToView = vi.fn(() => true)
        const views = new Set(['b.mmd'])
        const initialProps: { tabId: string; dimensions: Size } = { tabId: 'a.mmd', dimensions: null }
        const view = renderHook(
            ({ tabId, dimensions }) => useCanvasFitOnFirstView(dimensions, dimensions ? '<svg/>' : null, tabId, (id) => views.has(id), fitToView),
            { initialProps }
        )
        expect(fitToView).not.toHaveBeenCalled()

        view.rerender({ tabId: 'a.mmd', dimensions: SIZE })
        expect(fitToView).toHaveBeenCalledTimes(1)
        view.rerender({ tabId: 'a.mmd', dimensions: { width: 200, height: 50 } })
        expect(fitToView).toHaveBeenCalledTimes(1)

        view.rerender({ tabId: 'b.mmd', dimensions: SIZE })
        expect(fitToView).toHaveBeenCalledTimes(1)
    })
})
