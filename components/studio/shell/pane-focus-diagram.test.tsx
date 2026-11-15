import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import { MarkdownDocumentViewer } from '@/components/studio/markdown/markdown-document-viewer'
import { MarkdownExpandProvider } from '@/components/studio/markdown/markdown-expand-context'
import { cyclePaneFocus, focusPane } from '@/components/studio/shell/pane-focus'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"></svg>'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({
        svgForDisplay: SVG,
        dimensions: { width: 100, height: 50 },
        error: null,
        currentError: null,
        isStale: false,
        isPending: false,
        isEmpty: false,
    }),
}))

vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ registerFitToView: () => () => {}, registerZoomDiagram: () => () => {}, setCanFitToView: () => {} }),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTabId: 'flow.mmd', tabs: [{ id: 'flow.mmd', name: 'flow.mmd' }], openFile: async () => {} }),
    useCanvasFit: () => ({ canvasFitRequestId: 0, requestCanvasFit: () => {} }),
    useWorkspaceSession: () => ({ workspaceRoot: 'C:\\notes', tree: [] }),
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'scrivon-dark', isLight: false }),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    previewCodeTheme: () => 'github-dark',
    highlightFencedCodeNow: () => null,
    highlightFencedCode: () => new Promise<string>(() => {}),
}))

/** The explorer and the Preview region, as StudioLayout draws them. */
function Studio({ children }: { children: ReactNode }) {
    return (
        <>
            <aside data-pane="explorer">
                <div data-pane-focus>
                    <div role="treeitem" aria-selected={false} tabIndex={0} aria-label="flow.mmd" />
                </div>
            </aside>
            <div data-pane="preview" role="region" aria-label="Preview" tabIndex={-1}>
                {children}
            </div>
        </>
    )
}

const focused = () => document.activeElement as HTMLElement
const zoomLevel = (canvas: HTMLElement) => within(canvas).getByText(/%$/).textContent

afterEach(() => {
    focused()?.blur()
})

describe('moving to the preview of a diagram', () => {
    it('focuses the diagram canvas on a Mermaid tab, where the zoom and arrow keys work', () => {
        render(
            <Studio>
                <MermaidCanvas source="flowchart TD\n  A --> B" />
            </Studio>
        )
        const canvas = screen.getByRole('group', { name: 'Diagram canvas' })

        screen.getByRole('treeitem', { name: 'flow.mmd' }).focus()
        expect(cyclePaneFocus(1)).toBe(true)
        expect(focused()).toBe(canvas)

        screen.getByRole('treeitem', { name: 'flow.mmd' }).focus()
        cyclePaneFocus(-1)
        expect(focused()).toBe(canvas)

        screen.getByRole('treeitem', { name: 'flow.mmd' }).focus()
        expect(focusPane('preview')).toBe(true)
        expect(focused()).toBe(canvas)

        fireEvent.keyDown(focused(), { key: '0' })
        expect(zoomLevel(canvas)).toBe('100%')
        fireEvent.keyDown(focused(), { key: '+' })
        expect(zoomLevel(canvas)).toBe('125%')
    })

    it("focuses a full-size Markdown diagram's canvas, and Esc there closes it", () => {
        const source = ['# Flow', '', '```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n')
        render(
            <Studio>
                <MarkdownExpandProvider tabId="notes.md">
                    <MarkdownDocumentViewer tabId="notes.md" source={source} />
                </MarkdownExpandProvider>
            </Studio>
        )
        fireEvent.click(screen.getByRole('button', { name: 'Expand diagram 1' }))
        const expanded = screen.getByRole('region', { name: 'Expanded diagram' })

        screen.getByRole('treeitem', { name: 'flow.mmd' }).focus()
        cyclePaneFocus(1)
        expect(focused()).toBe(within(expanded).getByRole('group', { name: 'Diagram canvas' }))

        screen.getByRole('treeitem', { name: 'flow.mmd' }).focus()
        focusPane('preview')
        expect(focused()).toBe(within(expanded).getByRole('group', { name: 'Diagram canvas' }))

        fireEvent.keyDown(focused(), { key: 'Escape' })
        expect(screen.queryByRole('region', { name: 'Expanded diagram' })).toBeNull()
    })
})
