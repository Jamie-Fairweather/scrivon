import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import type { DocumentTab } from '@/lib/workspace/types'

type Layout = { explorerOpen: boolean; editorOpen: boolean }

let tabs: DocumentTab[] = []
let activeTabId: string | null = null
let layout: Layout = { explorerOpen: true, editorOpen: true }
/** The pan and zoom memory each canvas mount was given. */
const canvasMemories: (PanZoomMemory | undefined)[] = []
/** How many times the editor and the diagram canvas were mounted. A remount loses undo history and zoom. */
const mounts = { editor: 0, canvas: 0 }
/** A document the (mocked) Markdown preview crashes on. */
const BROKEN = '> > > (too deep)'

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
vi.mock('@/components/studio/canvas/mermaid-canvas', () => ({
    MermaidCanvas: ({ viewMemory }: { viewMemory?: PanZoomMemory }) => {
        useEffect(() => {
            mounts.canvas++
            canvasMemories.push(viewMemory)
        }, [viewMemory])
        return <div>Diagram preview</div>
    },
}))
vi.mock('@/components/studio/markdown/markdown-document-viewer', () => ({
    MarkdownDocumentViewer: ({ source }: { source: string }) => {
        if (source === BROKEN) throw new Error('Maximum call stack size exceeded')
        return <div>Markdown preview</div>
    },
}))
vi.mock('@/components/studio/editor/document-export-menu', () => ({ DocumentExportMenu: () => null }))
vi.mock('@/components/studio/hooks/use-window-close', () => ({ useWindowCloseHandler: () => {} }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: () => ({ settings: { keybinds: {} } }) }))
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
    CodeEditorPanel: ({ open = true }: { open?: boolean }) => {
        useEffect(() => {
            mounts.editor++
        }, [])
        return (
            <div data-slot="code-editor" className={open ? undefined : 'hidden'}>
                {activeTabId && <textarea aria-label="Editor" />}
            </div>
        )
    },
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
    mounts.editor = 0
    mounts.canvas = 0
    canvasMemories.length = 0
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

describe('StudioLayout tab switches', () => {
    function switchTabs(ids: string[]) {
        tabs = ids.map(tab)
        activeTabId = ids[0]!
        const view = render(<StudioLayout />)
        for (const id of [...ids.slice(1), ids[0]!]) {
            activeTabId = id
            view.rerender(<StudioLayout />)
        }
    }

    it('keeps the editor mounted when switching between Markdown tabs', () => {
        switchTabs(['/w/a.md', '/w/b.md'])
        expect(mounts.editor).toBe(1)
    })

    it('keeps the editor and the diagram canvas mounted when switching between diagram tabs', () => {
        switchTabs(['/w/x.mmd', '/w/y.mmd'])
        expect(screen.getByText('Diagram preview')).toBeInTheDocument()
        expect(mounts.canvas).toBe(1)
        expect(mounts.editor).toBe(1)
    })

    // The preview swaps between the Markdown viewer and the diagram canvas, but the editor must stay.
    it('keeps the editor mounted when switching between a Markdown tab and a diagram tab', () => {
        switchTabs(['/w/a.md', '/w/x.mmd'])
        expect(screen.getByText('Markdown preview')).toBeInTheDocument()
        expect(mounts.canvas).toBe(1)
        expect(mounts.editor).toBe(1)
    })

    it('gives the diagram canvas the same zoom memory when it comes back after a Markdown tab (N05)', () => {
        switchTabs(['/w/x.mmd', '/w/a.md'])
        expect(mounts.canvas).toBe(2)
        expect(canvasMemories[0]).toBeInstanceOf(Map)
        expect(canvasMemories[1]).toBe(canvasMemories[0])
    })

    it('forgets the zoom of a diagram tab closed while a Markdown tab shows (N05)', () => {
        tabs = [tab('/w/x.mmd'), tab('/w/a.md')]
        activeTabId = '/w/x.mmd'
        const view = render(<StudioLayout />)
        const memory = canvasMemories[0]!
        memory.set('/w/x.mmd', { x: 10, y: 20, scale: 3 })

        activeTabId = '/w/a.md'
        view.rerender(<StudioLayout />)
        tabs = [tab('/w/a.md')]
        view.rerender(<StudioLayout />)

        expect(memory.has('/w/x.mmd')).toBe(false)
    })
})

describe('StudioLayout when the preview breaks (N72)', () => {
    beforeEach(() => {
        // React and the boundary both log the caught error.
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => vi.restoreAllMocks())

    it('shows a notice in the preview’s place and keeps the editor and tabs, then tries again after an edit', () => {
        tabs = [{ ...tab('/w/a.md'), content: BROKEN }, tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const view = render(<StudioLayout />)

        expect(screen.getByText("Couldn't show this document")).toBeInTheDocument()
        expect(screen.getByText('Maximum call stack size exceeded')).toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'b.md' })).toBeInTheDocument()
        expect(mounts.editor).toBe(1)

        tabs = [{ ...tab('/w/a.md'), content: '# Fixed' }, tab('/w/b.md')]
        view.rerender(<StudioLayout />)
        expect(screen.getByText('Markdown preview')).toBeInTheDocument()
        expect(screen.queryByText("Couldn't show this document")).toBeNull()
        expect(mounts.editor).toBe(1)
    })

    it('shows another tab as usual', () => {
        tabs = [{ ...tab('/w/a.md'), content: BROKEN }, tab('/w/x.mmd')]
        activeTabId = '/w/a.md'
        const view = render(<StudioLayout />)
        expect(screen.getByText("Couldn't show this document")).toBeInTheDocument()

        activeTabId = '/w/x.mmd'
        view.rerender(<StudioLayout />)
        expect(screen.getByText('Diagram preview')).toBeInTheDocument()
    })
})

describe('StudioLayout find box', () => {
    // app/globals.css lets the find box's tooltips past every clip marked data-find-overflow-host.
    it('marks the editor row and column, so the find box tooltips are not cut off', () => {
        const { container } = render(<StudioLayout />)
        const editor = container.querySelector('[data-slot="code-editor"]')
        expect(editor?.parentElement).toHaveAttribute('data-find-overflow-host')
        expect(editor?.parentElement?.parentElement).toHaveAttribute('data-find-overflow-host')
    })
})

describe('StudioLayout keeps keyboard focus', () => {
    function focus(el: HTMLElement) {
        act(() => el.focus())
        expect(el).toHaveFocus()
    }

    it('moves focus to the new active tab when the focused tab is closed', async () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const view = render(<StudioLayout />)
        focus(screen.getByRole('tab', { name: 'a.md' }))

        tabs = [tab('/w/b.md')]
        activeTabId = '/w/b.md'
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'b.md' })).toHaveFocus())
    })

    it('moves focus to the active tab when the editor is hidden while typing in it', async () => {
        const view = render(<StudioLayout />)
        focus(screen.getByRole('textbox', { name: 'Editor' }))

        layout = { explorerOpen: true, editorOpen: false }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus())
    })

    it('moves focus to the active tab when the explorer is hidden while it has focus', async () => {
        const view = render(<StudioLayout />)
        focus(screen.getByRole('button', { name: 'notes.md' }))

        layout = { explorerOpen: false, editorOpen: true }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus())
    })

    it('moves focus to the start of the tab bar when the last tab is closed from the editor', async () => {
        const view = render(<StudioLayout />)
        focus(screen.getByRole('textbox', { name: 'Editor' }))

        tabs = []
        activeTabId = null
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle explorer' })).toHaveFocus())
    })

    it('leaves focus alone when the focused element is still there', async () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const view = render(<StudioLayout />)
        const editor = screen.getByRole('textbox', { name: 'Editor' })
        focus(editor)

        tabs = [tab('/w/a.md')]
        view.rerender(<StudioLayout />)
        await new Promise((resolve) => requestAnimationFrame(resolve))

        expect(editor).toHaveFocus()
    })
})
