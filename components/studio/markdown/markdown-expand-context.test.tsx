import { act, render, screen } from '@testing-library/react'
import { useEffect, useLayoutEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { MarkdownExpandProvider, useMarkdownExpand, type ExpandedMermaidBlock } from './markdown-expand-context'

const block = (blockId: string): ExpandedMermaidBlock => ({ blockId, source: 'flowchart TD\n  A --> B', canvasKey: `canvas:${blockId}` })

let mounts = 0
let api: ReturnType<typeof useMarkdownExpand> | null = null

function Probe() {
    const value = useMarkdownExpand()
    useLayoutEffect(() => {
        api = value
    })
    useEffect(() => {
        mounts += 1
    }, [])
    return <p data-testid="expanded">{value.expanded?.blockId ?? 'none'}</p>
}

function renderWithTab(tabId: string | null) {
    return render(
        <MarkdownExpandProvider tabId={tabId}>
            <Probe />
        </MarkdownExpandProvider>
    )
}

describe('MarkdownExpandProvider', () => {
    it('keeps its children mounted when the active tab changes', () => {
        mounts = 0
        const { rerender } = renderWithTab('a.md')
        rerender(
            <MarkdownExpandProvider tabId="b.md">
                <Probe />
            </MarkdownExpandProvider>
        )
        rerender(
            <MarkdownExpandProvider tabId="a.md">
                <Probe />
            </MarkdownExpandProvider>
        )
        expect(mounts).toBe(1)
    })

    it('closes the expanded diagram when switching to another tab', () => {
        const { rerender } = renderWithTab('a.md')
        act(() => api!.setExpanded(block('a.md:0:mermaid')))
        expect(screen.getByTestId('expanded')).toHaveTextContent('a.md:0:mermaid')

        rerender(
            <MarkdownExpandProvider tabId="b.md">
                <Probe />
            </MarkdownExpandProvider>
        )
        expect(screen.getByTestId('expanded')).toHaveTextContent('none')
        expect(api!.expanded).toBeNull()

        rerender(
            <MarkdownExpandProvider tabId="a.md">
                <Probe />
            </MarkdownExpandProvider>
        )
        expect(screen.getByTestId('expanded')).toHaveTextContent('none')
    })

    it('expands and closes a diagram within the current tab', () => {
        renderWithTab('b.md')
        act(() => api!.setExpanded(block('b.md:1:mermaid')))
        expect(api!.expanded?.blockId).toBe('b.md:1:mermaid')
        act(() => api!.setExpanded(null))
        expect(api!.expanded).toBeNull()
    })

    it('is a no-op outside a provider', () => {
        render(<Probe />)
        expect(api!.expanded).toBeNull()
        expect(() => api!.setExpanded(block('x'))).not.toThrow()
    })
})
