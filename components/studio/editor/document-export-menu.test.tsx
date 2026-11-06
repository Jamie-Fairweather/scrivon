import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'
import { DocumentExportMenu } from './document-export-menu'

const tabs = vi.hoisted(() => ({ activeTab: null as DocumentTab | null }))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTab: tabs.activeTab, activeTabId: tabs.activeTab?.id ?? null }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({ useMarkdownExpand: () => ({ expanded: null }) }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'light' }) }))
vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: () => ({ error: null, isPending: false }) }))
vi.mock('@/lib/mermaid/export', () => ({ exportSvg: vi.fn(), exportPng: vi.fn() }))
vi.mock('@/components/studio/editor/pdf-export-dialog', () => ({ PdfExportDialog: () => null }))

function tab(name: string, content: string): DocumentTab {
    return { id: name, path: `D:\\docs\\${name}`, name, content, isDirty: false, isSaving: false }
}

describe('DocumentExportMenu', () => {
    beforeEach(() => {
        tabs.activeTab = null
    })

    it('disables the export button when no document is open, instead of opening an empty menu', () => {
        render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('title', 'Open a document to export')
    })

    it('enables the export button for a markdown document', () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).not.toBeDisabled()
        expect(button).toHaveAttribute('title', 'Export document')
    })
})
