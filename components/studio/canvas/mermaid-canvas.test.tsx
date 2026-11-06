import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: vi.fn() }))

vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ registerFitToView: () => () => {}, setCanFitToView: () => {} }),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTabId: 'a.mmd', tabs: [{ id: 'a.mmd', name: 'flow.mmd' }] }),
    useCanvasFit: () => ({ canvasFitRequestId: 0 }),
}))

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"></svg>'

function mockHook(result: Partial<ReturnType<typeof useMermaidSvg>>) {
    vi.mocked(useMermaidSvg).mockReturnValue({
        svgForDisplay: null,
        dimensions: null,
        error: null,
        currentError: null,
        isStale: false,
        isPending: false,
        isEmpty: false,
        ...result,
    })
}

beforeEach(() => {
    vi.mocked(useMermaidSvg).mockReset()
})

describe('MermaidCanvas', () => {
    it('keeps the last good diagram and shows the error in a banner when the text is broken (U02)', () => {
        mockHook({ svgForDisplay: SVG, dimensions: { width: 100, height: 50 }, currentError: 'Invalid mermaid header', isStale: true })

        render(<MermaidCanvas source="graph" />)

        expect(screen.getAllByTitle('Diagram preview').length).toBeGreaterThan(0)
        const banner = screen.getByRole('status')
        expect(banner).toHaveTextContent('Diagram has an error')
        expect(banner).toHaveTextContent('Invalid mermaid header')
        expect(banner).toHaveTextContent('Showing the last version that worked.')
    })

    it('shows the error card when there is no earlier diagram', () => {
        mockHook({ error: 'Invalid mermaid header', currentError: 'Invalid mermaid header' })

        render(<MermaidCanvas source="graph" />)

        expect(screen.queryByTitle('Diagram preview')).toBeNull()
        expect(screen.getByRole('status')).toHaveTextContent('Invalid mermaid header')
        expect(screen.queryByText('Showing the last version that worked.')).toBeNull()
    })

    it('lets the error text be selected instead of starting a pan, outside the pan/zoom layer (U37)', () => {
        mockHook({ error: 'Invalid mermaid header', currentError: 'Invalid mermaid header' })

        render(<MermaidCanvas source="graph" />)

        const message = screen.getByText('Invalid mermaid header')
        expect(message.closest('.origin-center')).toBeNull()
        // The canvas calls preventDefault on pointer down to pan, which would block text selection.
        expect(fireEvent.pointerDown(message, { button: 0, pointerId: 1 })).toBe(true)
    })

    it('shows the empty message outside the pan/zoom layer, so zoom never shrinks it (U37)', () => {
        mockHook({})

        render(<MermaidCanvas source="" />)

        const message = screen.getByText('Add Mermaid syntax to preview a diagram.')
        expect(message.closest('.origin-center')).toBeNull()
    })

    it('shows no banner when the diagram is fine', () => {
        mockHook({ svgForDisplay: SVG, dimensions: { width: 100, height: 50 } })

        render(<MermaidCanvas source="graph TD" />)

        expect(screen.getAllByTitle('Diagram preview').length).toBeGreaterThan(0)
        expect(screen.queryByRole('status')).toBeNull()
    })

    it('says the diagram is rendering instead of showing a blank canvas (U38)', () => {
        mockHook({ isPending: true })

        render(<MermaidCanvas source={'graph TD\n  A --> B'} />)

        expect(screen.getByRole('status')).toHaveTextContent('Rendering diagram…')
        expect(screen.queryByText('Add Mermaid syntax to preview a diagram.')).toBeNull()
    })

    it('says when the diagram has nothing to draw yet (U39)', () => {
        mockHook({ isEmpty: true })

        render(<MermaidCanvas source="graph TD" />)

        expect(screen.getByText('Nothing to draw yet. Add some nodes to see the diagram.')).toBeInTheDocument()
        expect(screen.queryByTitle('Diagram preview')).toBeNull()
    })

    it('exposes the diagram as one named image and keeps its frames out of the Tab order (A27)', () => {
        mockHook({ svgForDisplay: SVG, dimensions: { width: 100, height: 50 } })

        render(<MermaidCanvas source="graph TD" />)

        expect(screen.getByRole('img', { name: 'Diagram: flow.mmd' })).toBeInTheDocument()
        const frames = screen.getAllByTitle('Diagram preview')
        for (const frame of frames) {
            expect(frame).toHaveAttribute('tabindex', '-1')
            expect(frame).toHaveAttribute('aria-hidden', 'true')
            expect(frame).toHaveAttribute('inert')
        }
    })
})
