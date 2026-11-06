import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'

type Layout = { explorerOpen: boolean; editorOpen: boolean }

let tabs: DocumentTab[] = []
let activeTabId: string | null = null
let layout: Layout = { explorerOpen: true, editorOpen: true }

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs,
        activeTabId,
        activeTab: tabs.find((t) => t.id === activeTabId) ?? null,
        setActiveTab: vi.fn(),
        closeTab: vi.fn(),
        closeOtherTabs: vi.fn(),
        closeAllTabs: vi.fn(),
    }),
    useStudioLayout: () => ({ layout, setExplorerOpen: vi.fn(), setEditorOpen: vi.fn() }),
}))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    CanvasControlsProvider: ({ children }: { children: ReactNode }) => children,
    useCanvasControls: () => ({ canFitToView: false, fitToView: () => {} }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({
    MarkdownExpandProvider: ({ children }: { children: ReactNode }) => children,
    useMarkdownExpand: () => ({ expanded: false }),
}))
vi.mock('@/components/studio/canvas/mermaid-canvas', () => ({ MermaidCanvas: () => <div>Diagram preview</div> }))
vi.mock('@/components/studio/markdown/markdown-document-viewer', () => ({ MarkdownDocumentViewer: () => <div>Markdown preview</div> }))
vi.mock('@/components/studio/editor/document-export-menu', () => ({ DocumentExportMenu: () => null }))
vi.mock('@/components/studio/hooks/use-window-close', () => ({ useWindowCloseHandler: () => {} }))
vi.mock('@/components/studio/editor/use-editor-panel-layout', () => ({
    useEditorPanelLayout: () => ({ width: 400, hydrated: true, onWidthChange: () => {}, resetEditorWidth: () => {} }),
}))
vi.mock('@/components/studio/explorer/workspace-explorer', () => ({
    WorkspaceExplorer: () => (
        <nav aria-label="Explorer">
            <button type="button">notes.md</button>
        </nav>
    ),
}))
// Stands in for Monaco: hidden (not unmounted) when the editor is switched off, like the real panel.
vi.mock('@/components/studio/editor/code-editor-panel', () => ({
    CodeEditorPanel: ({ open = true }: { open?: boolean }) => (
        <div data-slot="code-editor" className={open ? undefined : 'hidden'}>
            {activeTabId && <textarea aria-label="Editor" />}
        </div>
    ),
}))

const { StudioLayout } = await import('./studio-layout')

function tab(path: string): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content: '', isDirty: false, isSaving: false }
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
    tabs = [tab('/w/a.md')]
    activeTabId = '/w/a.md'
    layout = { explorerOpen: true, editorOpen: true }
})

afterEach(() => {
    window.matchMedia = originalMatchMedia
})

describe('StudioLayout explorer', () => {
    it('shows the explorer in a narrow window when it is switched on', () => {
        // A window snapped to half of a 1920px screen at 125% scaling is 768 CSS px wide.
        window.matchMedia = vi.fn((query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        }))
        render(<StudioLayout />)
        expect(screen.getByRole('navigation', { name: 'Explorer' })).toBeInTheDocument()
    })

    it('hides the explorer when it is switched off', () => {
        layout = { explorerOpen: false, editorOpen: true }
        render(<StudioLayout />)
        expect(screen.queryByRole('navigation', { name: 'Explorer' })).not.toBeInTheDocument()
    })
})
