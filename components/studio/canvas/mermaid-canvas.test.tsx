import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: vi.fn() }))

vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ registerFitToView: () => () => {}, setCanFitToView: () => {} }),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTabId: 'a.mmd', tabs: [{ id: 'a.mmd' }] }),
    useCanvasFit: () => ({ canvasFitRequestId: 0 }),
}))

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"></svg>'

function mockHook(result: Partial<ReturnType<typeof useMermaidSvg>>) {
    vi.mocked(useMermaidSvg).mockReturnValue({
        svgForDisplay: null,
        dimensions: null,
        error: null,
        isStale: false,
        isPending: false,
        ...result,
    })
}

beforeEach(() => {
    vi.mocked(useMermaidSvg).mockReset()
})

describe('MermaidCanvas', () => {
    it('keeps the last good diagram and shows the error in a banner when the text is broken (U02)', () => {
        mockHook({ svgForDisplay: SVG, dimensions: { width: 100, height: 50 }, error: 'Invalid mermaid header', isStale: true })

        render(<MermaidCanvas source="graph" />)

        expect(screen.getAllByTitle('Diagram preview').length).toBeGreaterThan(0)
        const banner = screen.getByRole('status')
        expect(banner).toHaveTextContent('Diagram has an error')
        expect(banner).toHaveTextContent('Invalid mermaid header')
        expect(banner).toHaveTextContent('Showing the last version that worked.')
    })

    it('shows the error card when there is no earlier diagram', () => {
        mockHook({ error: 'Invalid mermaid header' })

        render(<MermaidCanvas source="graph" />)

        expect(screen.queryByTitle('Diagram preview')).toBeNull()
        expect(screen.queryByRole('status')).toBeNull()
        expect(screen.getByText('Invalid mermaid header')).toBeInTheDocument()
    })

    it('shows no banner when the diagram is fine', () => {
        mockHook({ svgForDisplay: SVG, dimensions: { width: 100, height: 50 } })

        render(<MermaidCanvas source="graph TD" />)

        expect(screen.getAllByTitle('Diagram preview').length).toBeGreaterThan(0)
        expect(screen.queryByRole('status')).toBeNull()
    })
})
