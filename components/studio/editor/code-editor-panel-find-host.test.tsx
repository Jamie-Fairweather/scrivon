import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'

// Stands in for Monaco, which is loaded through next/dynamic.
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="monaco" /> }))

const tab: DocumentTab = { id: '/w/a.md', path: '/w/a.md', name: 'a.md', content: '# A', isDirty: false, isSaving: false }

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs: [tab], activeTabId: tab.id, activeTab: tab, updateTabContent: () => {} }),
    useWorkspaceCoordinator: () => ({}),
}))
vi.mock('@/components/studio/workspace/register-coordinator-refs', () => ({ registerCoordinatorRefs: () => {} }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ isLight: true, tokens: {} }) }))
vi.mock('@/lib/theme/monaco-theme', () => ({ MONACO_DIAGRAM_THEME_ID: 'test-theme', defineMonacoDiagramTheme: () => {} }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { editor: { fontSize: 13, tabSize: 2, wordWrap: 'on', lineNumbers: 'on', minimap: false } } }),
}))

const { CodeEditorPanel } = await import('./code-editor-panel')

describe('CodeEditorPanel find box', () => {
    // app/globals.css lets the find box's tooltips past every clip marked data-find-overflow-host.
    it('marks the box that clips the editor, so the find box tooltips are not cut off', () => {
        render(<CodeEditorPanel width={400} onWidthChange={() => {}} />)
        expect(screen.getByTestId('monaco').parentElement).toHaveAttribute('data-find-overflow-host')
    })
})
