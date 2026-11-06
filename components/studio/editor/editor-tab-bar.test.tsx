import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'

let tabs: DocumentTab[] = []
let activeTabId: string | null = null
const setActiveTab = vi.fn(async (id: string) => {
    activeTabId = id
})
const closeTab = vi.fn(async () => {})

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs,
        activeTabId,
        activeTab: tabs.find((t) => t.id === activeTabId) ?? null,
        setActiveTab,
        closeTab,
        closeOtherTabs: vi.fn(),
        closeAllTabs: vi.fn(),
    }),
}))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ canFitToView: false, fitToView: () => {} }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({ useMarkdownExpand: () => ({ expanded: false }) }))
vi.mock('@/components/studio/editor/document-export-menu', () => ({ DocumentExportMenu: () => null }))
vi.mock('@/components/studio/editor/layout-toggle-buttons', () => ({ LayoutToggleButtons: () => null }))

const { EditorTabBar } = await import('./editor-tab-bar')

function tab(path: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content: '', isDirty: false, isSaving: false, ...extra }
}

beforeEach(() => {
    setActiveTab.mockClear()
    closeTab.mockClear()
})

describe('EditorTabBar', () => {
    it('exposes the open documents as tabs, with the active one selected', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/b.md'
        render(<EditorTabBar />)

        expect(screen.getByRole('tablist', { name: 'Open documents' })).toBeInTheDocument()
        const [a, b] = screen.getAllByRole('tab')
        expect(a).toHaveAttribute('aria-selected', 'false')
        expect(b).toHaveAttribute('aria-selected', 'true')
        // Only the active tab is a Tab stop.
        expect(a).toHaveAttribute('tabindex', '-1')
        expect(b).toHaveAttribute('tabindex', '0')
    })

    it('tells assistive tech about unsaved, saving, read-only and failed saves', () => {
        tabs = [
            tab('/w/dirty.md', { isDirty: true }),
            tab('/w/saving.md', { isSaving: true }),
            tab('example:x', { name: 'Example.mmd', readOnly: true }),
            tab('/w/failed.md', { isDirty: true, saveError: 'Disk full' }),
        ]
        activeTabId = '/w/dirty.md'
        render(<EditorTabBar />)

        expect(screen.getByRole('tab', { name: 'dirty.md , unsaved changes' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'saving.md , saving' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Example.mmd , read-only example' })).toBeInTheDocument()
        const failed = screen.getByRole('tab', { name: 'failed.md , unsaved changes, save failed: Disk full' })
        expect(failed).toHaveAttribute('title', 'Save failed: Disk full')
        expect(screen.getByRole('button', { name: 'Close dirty.md, unsaved changes' })).toHaveAttribute('tabindex', '-1')
    })

    it('moves between tabs with the arrow, Home and End keys', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md')]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)
        const [a, b, c] = screen.getAllByRole('tab')

        fireEvent.keyDown(a!, { key: 'ArrowRight' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/b.md')
        expect(b).toHaveFocus()

        fireEvent.keyDown(a!, { key: 'ArrowLeft' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/c.md')
        expect(c).toHaveFocus()

        fireEvent.keyDown(c!, { key: 'Home' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/a.md')

        fireEvent.keyDown(a!, { key: 'End' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/c.md')
    })
})
