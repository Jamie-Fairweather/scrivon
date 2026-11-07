import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'
import { DocumentExportMenu } from './document-export-menu'

const tabs = vi.hoisted(() => ({ activeTab: null as DocumentTab | null }))
/** Tabs whose web images the user chose to load in the preview. */
const remoteImageTabs = vi.hoisted(() => new Set<string>())
type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; tabPath?: string; allowRemoteImages?: boolean }
const dialogProps = vi.hoisted(() => ({ current: null as DialogProps | null }))
/** The props the export dialog last rendered with, or null when the menu left it out. */
const lastDialog = (): DialogProps | null => dialogProps.current

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTab: tabs.activeTab, activeTabId: tabs.activeTab?.id ?? null }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({
    useMarkdownExpand: () => ({ expanded: null }),
    useMarkdownPreviewMemory: () => ({ scrollTopByTab: new Map(), remoteImageTabs, allowRemoteImages: () => undefined }),
}))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'light' }) }))
vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: () => ({ error: null, isPending: false }) }))
vi.mock('@/lib/mermaid/export', () => ({ exportSvg: vi.fn(), exportPng: vi.fn() }))
vi.mock('@/components/studio/editor/pdf-export-dialog', () => ({
    PdfExportDialog: (props: DialogProps) => {
        dialogProps.current = props
        return null
    },
}))

function tab(name: string, content: string): DocumentTab {
    return { id: name, path: `D:\\docs\\${name}`, name, content, isDirty: false, isSaving: false }
}

describe('DocumentExportMenu', () => {
    beforeEach(() => {
        tabs.activeTab = null
        dialogProps.current = null
        remoteImageTabs.clear()
    })

    it('lets the PDF print web images only for a tab whose preview loaded them', () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<DocumentExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(false)

        // The user clicked 'Load images' in this tab's preview.
        remoteImageTabs.add('notes.md')
        view.rerender(<DocumentExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(true)

        // Another tab keeps its web images out of the PDF.
        tabs.activeTab = tab('other.md', '# Other')
        view.rerender(<DocumentExportMenu />)
        expect(lastDialog()?.allowRemoteImages).toBe(false)
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
        // The export dialog gets the file's path so its save dialog starts in the same folder.
        expect(dialogProps.current?.tabPath).toBe('D:\\docs\\notes.md')
    })

    it('does not pop the export dialog open again after a switch to a non-markdown tab and back', () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<DocumentExportMenu />)
        act(() => lastDialog()?.onOpenChange(true))
        expect(lastDialog()?.open).toBe(true)

        // A Mermaid tab has no export dialog, so it goes away...
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->B')
        dialogProps.current = null
        view.rerender(<DocumentExportMenu />)
        expect(lastDialog()).toBeNull()

        // ...and coming back to a Markdown tab must not reopen it by itself.
        tabs.activeTab = tab('notes.md', '# Notes')
        view.rerender(<DocumentExportMenu />)
        expect(lastDialog()?.open).toBe(false)
    })
})
