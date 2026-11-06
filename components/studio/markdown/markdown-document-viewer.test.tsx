import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownExpandProvider } from './markdown-expand-context'
import { MarkdownDocumentViewer } from './markdown-document-viewer'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useCanvasFit: () => ({ canvasFitRequestId: 0, requestCanvasFit: () => {} }),
}))

vi.mock('@/components/studio/canvas/mermaid-canvas', () => ({
    MermaidCanvas: ({ source }: { source: string }) => <div data-testid="expanded-canvas">{source}</div>,
}))

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
}))

function viewer(tabId: string, source: string) {
    return (
        <MarkdownExpandProvider tabId={tabId}>
            <MarkdownDocumentViewer tabId={tabId} source={source} />
        </MarkdownExpandProvider>
    )
}

function viewport(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
}

describe('MarkdownDocumentViewer', () => {
    it('shows the new tab’s document straight away when switching tabs', () => {
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        rerender(viewer('b.md', '# Beta'))
        expect(container.querySelector('h1')).toHaveTextContent('Beta')
    })

    it('remembers the preview scroll position for each tab', () => {
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        const scroller = viewport(container)
        scroller.scrollTop = 300
        fireEvent.scroll(scroller)

        rerender(viewer('b.md', '# Beta'))
        expect(viewport(container)).toBe(scroller)
        expect(scroller.scrollTop).toBe(0)

        rerender(viewer('a.md', '# Alpha'))
        expect(scroller.scrollTop).toBe(300)
    })
})
