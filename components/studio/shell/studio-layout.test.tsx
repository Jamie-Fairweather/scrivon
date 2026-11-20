import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanZoomMemory } from '@/components/studio/canvas/use-pan-zoom'
import type { DocumentTab } from '@/lib/workspace/types'

type Layout = { explorerOpen: boolean; editorOpen: boolean; previewOpen: boolean; outlineOpen?: boolean }

let tabs: DocumentTab[] = []
let activeTabId: string | null = null
let layout: Layout = { explorerOpen: true, editorOpen: true, previewOpen: true }
let focusMode = false
const setFocusMode = vi.fn()
/** The layout the context gives in focus mode (studio-layout-context.tsx): the editor alone. */
const FOCUS_LAYOUT: Layout = { explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false }
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
    useStudioLayout: () => ({ layout, focusMode, setFocusMode, setExplorerOpen: vi.fn(), setEditorOpen: vi.fn() }),
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
        return (
            <>
                <div>Markdown preview</div>
                <a href="#install">Install link</a>
            </>
        )
    },
}))
vi.mock('@/components/studio/editor/document-export-menu', () => ({ DocumentExportMenu: () => null }))
vi.mock('@/components/studio/dialogs/file-history-provider', () => ({ useFileHistory: () => ({ showFileHistory: vi.fn() }) }))
vi.mock('@/components/studio/editor/document-export-provider', () => ({
    DocumentExportProvider: ({ children }: { children: ReactNode }) => <div data-testid="document-export">{children}</div>,
}))
vi.mock('@/components/studio/batch-export/batch-export-provider', () => ({
    BatchExportProvider: ({ children }: { children: ReactNode }) => <div data-testid="batch-export">{children}</div>,
}))
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
vi.mock('@/components/studio/outline/outline-panel', () => ({
    OutlinePanel: () => (
        <nav aria-label="Outline">
            <button type="button">Install</button>
        </nav>
    ),
}))
// Stands in for Monaco: hidden (not unmounted) when the editor is switched off, like the real panel.
vi.mock('@/components/studio/editor/code-editor-panel', () => ({
    CodeEditorPanel: ({ open = true, fill = false, focusMode = false }: { open?: boolean; fill?: boolean; focusMode?: boolean }) => {
        useEffect(() => {
            mounts.editor++
        }, [])
        return (
            <div
                data-slot="code-editor"
                data-pane="editor"
                data-fill={fill}
                data-focus-mode={focusMode}
                tabIndex={focusMode ? -1 : undefined}
                className={open ? undefined : 'hidden'}
            >
                {activeTabId && <textarea aria-label="Editor" />}
            </div>
        )
    },
}))

vi.mock('@/components/studio/shell/studio-status-bar', () => ({ StudioStatusBar: () => <footer aria-label="Status bar" /> }))

const { StudioLayout } = await import('./studio-layout')
const { focusPane } = await import('./pane-focus')

function tab(path: string): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content: '', isDirty: false, isSaving: false }
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
    tabs = [tab('/w/a.md')]
    activeTabId = '/w/a.md'
    layout = { explorerOpen: true, editorOpen: true, previewOpen: true }
    focusMode = false
    setFocusMode.mockReset()
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
        layout = { explorerOpen: false, editorOpen: true, previewOpen: true }
        render(<StudioLayout />)
        expect(screen.queryByRole('navigation', { name: 'Explorer' })).not.toBeInTheDocument()
    })
})

describe('StudioLayout folder export', () => {
    it('puts the folder export around the explorer and the tabs, so both can start it and the tab bar sees it running', () => {
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: true }
        render(<StudioLayout />)

        const batch = screen.getByTestId('batch-export')
        expect(batch).toContainElement(screen.getByRole('navigation', { name: 'Explorer' }))
        expect(batch).toContainElement(screen.getByRole('navigation', { name: 'Outline' }))
        expect(batch).toContainElement(screen.getByTestId('document-export'))
        expect(batch).toContainElement(screen.getByRole('main'))
    })
})

describe('StudioLayout Outline panel', () => {
    it('shows the Outline panel between the explorer and the editor when it is switched on', () => {
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: true }
        render(<StudioLayout />)

        const explorer = screen.getByRole('navigation', { name: 'Explorer' })
        const outline = screen.getByRole('navigation', { name: 'Outline' })
        const editor = screen.getByRole('textbox', { name: 'Editor' })
        expect(explorer.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(outline.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('hides the Outline panel when it is switched off', () => {
        render(<StudioLayout />)
        expect(screen.queryByRole('navigation', { name: 'Outline' })).not.toBeInTheDocument()
    })
})

describe('StudioLayout landmarks and panes', () => {
    it('has exactly one main landmark, holding the tabs, the editor and the preview', () => {
        render(<StudioLayout />)

        const [main, ...more] = screen.getAllByRole('main')
        expect(more).toHaveLength(0)
        expect(main).toContainElement(screen.getByRole('tab', { name: 'a.md' }))
        expect(main).toContainElement(screen.getByRole('textbox', { name: 'Editor' }))
        expect(main).toContainElement(screen.getByRole('region', { name: 'Preview' }))
        expect(main).not.toContainElement(screen.getByRole('navigation', { name: 'Explorer' }))
    })

    it('lets the keyboard reach the preview, even when nothing in it can take focus', () => {
        render(<StudioLayout />)
        const preview = screen.getByRole('region', { name: 'Preview' })

        act(() => {
            expect(focusPane('preview')).toBe(true)
        })
        expect(preview).toHaveFocus()
        expect(preview).toContainElement(screen.getByText('Markdown preview'))
    })
})

describe('StudioLayout preview', () => {
    it('shows the preview beside an editor of its own width', () => {
        render(<StudioLayout />)
        expect(screen.getByText('Markdown preview')).toBeInTheDocument()
        expect(document.querySelector('[data-slot="code-editor"]')).toHaveAttribute('data-fill', 'false')
    })

    it('hides the preview and lets the editor fill the space, keeping the editor mounted', () => {
        const view = render(<StudioLayout />)

        layout = { explorerOpen: true, editorOpen: true, previewOpen: false }
        view.rerender(<StudioLayout />)
        expect(screen.queryByText('Markdown preview')).toBeNull()
        expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull()
        expect(document.querySelector('[data-slot="code-editor"]')).toHaveAttribute('data-fill', 'true')

        layout = { explorerOpen: true, editorOpen: true, previewOpen: true }
        view.rerender(<StudioLayout />)
        expect(screen.getByText('Markdown preview')).toBeInTheDocument()
        expect(mounts.editor).toBe(1)
    })

    it('hides the diagram too', () => {
        tabs = [tab('/w/x.mmd')]
        activeTabId = '/w/x.mmd'
        layout = { explorerOpen: true, editorOpen: true, previewOpen: false }
        render(<StudioLayout />)
        expect(screen.queryByText('Diagram preview')).toBeNull()
    })
})

describe('StudioLayout status bar', () => {
    it('shows the status bar along the bottom, below the panes', () => {
        render(<StudioLayout />)
        const bar = screen.getByRole('contentinfo', { name: 'Status bar' })
        const editor = document.querySelector('[data-slot="code-editor"]')!
        expect(editor.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(bar.parentElement?.contains(screen.getByRole('navigation', { name: 'Explorer' }))).toBe(true)
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

describe('StudioLayout focus mode', () => {
    function enterFocusMode() {
        focusMode = true
        layout = FOCUS_LAYOUT
    }

    it('shows only the editor, filling the window: no explorer, Outline, tab bar, preview or status bar', () => {
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: true }
        const view = render(<StudioLayout />)
        enterFocusMode()
        view.rerender(<StudioLayout />)

        expect(screen.queryByRole('navigation', { name: 'Explorer' })).toBeNull()
        expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull()
        expect(screen.queryByRole('tab', { name: 'a.md' })).toBeNull()
        expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull()
        expect(screen.queryByRole('contentinfo', { name: 'Status bar' })).toBeNull()
        const editor = document.querySelector('[data-slot="code-editor"]')
        expect(editor).toHaveAttribute('data-fill', 'true')
        expect(editor).toHaveAttribute('data-focus-mode', 'true')
        expect(screen.getByRole('main')).toContainElement(screen.getByRole('textbox', { name: 'Editor' }))
    })

    it('keeps the export (File menu, palette, Ctrl+Shift+X) and the folder export mounted', () => {
        enterFocusMode()
        render(<StudioLayout />)
        expect(screen.getByTestId('document-export')).toBeInTheDocument()
        expect(screen.getByTestId('batch-export')).toBeInTheDocument()
    })

    it('keeps the same editor, so its undo history and cursor stay, and brings the panes back when it ends', () => {
        const view = render(<StudioLayout />)
        enterFocusMode()
        view.rerender(<StudioLayout />)
        focusMode = false
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true }
        view.rerender(<StudioLayout />)

        expect(mounts.editor).toBe(1)
        expect(screen.getByRole('tab', { name: 'a.md' })).toBeInTheDocument()
        expect(screen.getByRole('contentinfo', { name: 'Status bar' })).toBeInTheDocument()
        expect(screen.getByRole('navigation', { name: 'Explorer' })).toBeInTheDocument()
    })

    it('tells a screen reader focus mode is on, and how to leave it', () => {
        const view = render(<StudioLayout />)
        const status = document.querySelector('[data-slot="focus-mode-announcement"]')!
        expect(status).toHaveAttribute('role', 'status')
        expect(status).toHaveTextContent('')

        enterFocusMode()
        view.rerender(<StudioLayout />)
        expect(status).toHaveTextContent('Focus mode on. Press Escape to leave.')
    })

    it('leaves on Esc from anywhere, with no file open too', () => {
        tabs = []
        activeTabId = null
        enterFocusMode()
        render(<StudioLayout />)

        act(() => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
        expect(setFocusMode).toHaveBeenCalledWith(false)
    })

    it('leaves Esc alone outside focus mode', () => {
        render(<StudioLayout />)
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
        expect(setFocusMode).not.toHaveBeenCalled()
    })

    it('leaves only the editor for F6 to reach', () => {
        enterFocusMode()
        render(<StudioLayout />)
        expect([...document.querySelectorAll('[data-pane]')].map((pane) => pane.getAttribute('data-pane'))).toEqual(['editor'])
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

        layout = { explorerOpen: true, editorOpen: false, previewOpen: true }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus())
    })

    it('moves focus to the active tab when the preview is hidden while it has focus', async () => {
        const view = render(<StudioLayout />)
        focus(screen.getByRole('link', { name: 'Install link' }))

        layout = { explorerOpen: true, editorOpen: true, previewOpen: false }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus())
    })

    it('moves focus to the active tab when the explorer is hidden while it has focus', async () => {
        const view = render(<StudioLayout />)
        focus(screen.getByRole('button', { name: 'notes.md' }))

        layout = { explorerOpen: false, editorOpen: true, previewOpen: true }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus())
    })

    it('moves focus to the active tab when the Outline panel is hidden while it has focus', async () => {
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: true }
        const view = render(<StudioLayout />)
        focus(screen.getByRole('button', { name: 'Install' }))

        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: false }
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

    it('moves focus to the editor region, not the page, when the last tab is closed in focus mode', async () => {
        focusMode = true
        layout = FOCUS_LAYOUT
        const view = render(<StudioLayout />)
        focus(screen.getByRole('textbox', { name: 'Editor' }))

        tabs = []
        activeTabId = null
        view.rerender(<StudioLayout />)

        const region = document.querySelector('[data-pane="editor"]')
        await waitFor(() => expect(region).toHaveFocus())
    })

    it('moves focus to the tab bar when focus mode ends while the empty editor region has it', async () => {
        tabs = []
        activeTabId = null
        focusMode = true
        layout = FOCUS_LAYOUT
        const view = render(<StudioLayout />)
        focus(document.querySelector<HTMLElement>('[data-pane="editor"]')!)

        focusMode = false
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true }
        view.rerender(<StudioLayout />)

        await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle explorer' })).toHaveFocus())
    })

    it('moves focus to the editor when focus mode hides the pane that had it', async () => {
        layout = { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen: true }
        const view = render(<StudioLayout />)
        focus(screen.getByRole('button', { name: 'Install' }))

        focusMode = true
        layout = FOCUS_LAYOUT
        view.rerender(<StudioLayout />)

        // focusPane('editor') first: Monaco itself, when it has a file (none here, so the region).
        await waitFor(() => expect(document.querySelector('[data-pane="editor"]')).toHaveFocus())
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
