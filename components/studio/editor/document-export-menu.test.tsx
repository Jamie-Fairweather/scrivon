import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportSvg } from '@/lib/mermaid/export'
import type { DocumentTab } from '@/lib/workspace/types'
import { DocumentExportMenu } from './document-export-menu'

const tabs = vi.hoisted(() => ({ activeTab: null as DocumentTab | null }))
/** Tabs whose web images the user chose to load in the preview. */
const remoteImageTabs = vi.hoisted(() => new Set<string>())
/** What drawing the diagram gave: an error, still drawing, or nothing to draw. */
const diagram = vi.hoisted(() => ({ currentError: null as string | null, isPending: false, isStale: false, isEmpty: false }))
type DialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    tabPath?: string
    workspaceRoot?: string | null
    allowRemoteImages?: boolean
}
const dialogProps = vi.hoisted(() => ({ current: null as DialogProps | null }))
/** The props the export dialog last rendered with, or null when the menu left it out. */
const lastDialog = (): DialogProps | null => dialogProps.current

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTab: tabs.activeTab, activeTabId: tabs.activeTab?.id ?? null }),
    useWorkspaceSession: () => ({ workspaceRoot: 'D:\\docs' }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({
    useMarkdownExpand: () => ({ expanded: null }),
    useMarkdownPreviewMemory: () => ({ scrollTopByTab: new Map(), remoteImageTabs, allowRemoteImages: () => undefined }),
}))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'light' }) }))
vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: () => ({ error: diagram.currentError, ...diagram }) }))
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

/** The tooltip's own text (the button's description holds a hidden copy of it). */
const inTooltip = { selector: '[data-slot="tooltip-popup"] *' }

describe('DocumentExportMenu', () => {
    beforeEach(() => {
        tabs.activeTab = null
        dialogProps.current = null
        remoteImageTabs.clear()
        Object.assign(diagram, { currentError: null, isPending: false, isStale: false, isEmpty: false })
        vi.mocked(exportSvg).mockClear()
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

    it('turns the export button off when no document is open, instead of opening an empty menu', async () => {
        render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        // Off but still focusable, so a keyboard user can hear why.
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).not.toBeDisabled()
        expect(button).not.toHaveAttribute('title')
        expect(button).toHaveAccessibleDescription('Open a document to export')

        act(() => button.focus())
        expect(await screen.findByText('Open a document to export', inTooltip)).toBeInTheDocument()

        fireEvent.click(button)
        expect(screen.queryByRole('menu')).toBeNull()
    })

    it('turns the export button on for a markdown document', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).not.toHaveAttribute('aria-disabled')
        expect(button).not.toHaveAttribute('title')
        // The export dialog gets the file's path so its save dialog starts in the same folder.
        expect(dialogProps.current?.tabPath).toBe('D:\\docs\\notes.md')
        // And the open folder, so the export can embed the images in it.
        expect(dialogProps.current?.workspaceRoot).toBe('D:\\docs')

        expect(button).not.toHaveAccessibleDescription()

        act(() => button.focus())
        expect(await screen.findByText('Export document', inTooltip)).toBeInTheDocument()

        fireEvent.click(button)
        // Both document exports are marked as beta.
        expect(await screen.findByRole('menuitem', { name: 'Save PDF Beta' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Save Word Beta' })).toBeInTheDocument()
    })

    it.each([
        { case: 'an empty Markdown file', name: 'notes.md', content: '  \n', state: {}, reason: 'Nothing to export: the document is empty' },
        { case: 'an empty diagram', name: 'flow.mmd', content: '', state: {}, reason: 'Nothing to export: the diagram is empty' },
        {
            case: 'a diagram with an error',
            name: 'flow.mmd',
            content: 'graph TD; A--',
            state: { currentError: 'Parse error' },
            reason: 'Fix the diagram error to export',
        },
        { case: 'a diagram still drawing', name: 'flow.mmd', content: 'graph TD; A-->B', state: { isPending: true }, reason: 'Drawing the diagram…' },
        { case: 'a diagram with nothing to draw', name: 'flow.mmd', content: '%% note', state: { isEmpty: true }, reason: 'No diagram to export' },
    ])('says why the export button is off for $case, also to screen readers', async ({ name, content, state, reason }) => {
        Object.assign(diagram, state)
        tabs.activeTab = tab(name, content)
        render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveAccessibleDescription(reason)

        act(() => button.focus())
        expect(await screen.findByText(reason, inTooltip)).toBeInTheDocument()
    })

    it('shuts the open menu when the export button turns off', async () => {
        tabs.activeTab = tab('notes.md', '# Notes')
        const view = render(<DocumentExportMenu />)
        fireEvent.click(screen.getByRole('button', { name: 'Export document' }))
        expect(await screen.findByRole('menuitem', { name: 'Save PDF Beta' })).toBeInTheDocument()

        // An empty document has nothing to export.
        tabs.activeTab = tab('notes.md', '')
        view.rerender(<DocumentExportMenu />)
        await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Save PDF Beta' })).toBeNull())
        expect(screen.getByRole('button', { name: 'Export document' })).toHaveAttribute('aria-disabled', 'true')
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

    it('greys out Save SVG and Save PNG while the edited diagram is still rendering behind the older picture (N19)', async () => {
        tabs.activeTab = tab('flow.mmd', 'graph TD; A-->')
        diagram.isStale = true
        const view = render(<DocumentExportMenu />)
        const button = screen.getByRole('button', { name: 'Export document' })
        // The button itself stays on, so it doesn't flicker while typing.
        expect(button).not.toHaveAttribute('aria-disabled')

        fireEvent.click(button)
        const saveSvg = await screen.findByRole('menuitem', { name: 'Save SVG' })
        const savePng = screen.getByRole('menuitem', { name: 'Save PNG' })
        expect(saveSvg).toHaveAttribute('aria-disabled', 'true')
        expect(savePng).toHaveAttribute('aria-disabled', 'true')
        // A spinner on each says they are waiting for the drawing, not broken.
        expect(saveSvg).toHaveAttribute('aria-busy', 'true')
        expect(savePng).toHaveAttribute('aria-busy', 'true')
        expect(saveSvg.querySelector('svg.animate-spin')).not.toBeNull()
        expect(savePng.querySelector('svg.animate-spin')).not.toBeNull()
        fireEvent.click(saveSvg)
        // The export code loads on first use, so give a click that got through time to arrive.
        await act(async () => {
            await import('@/lib/mermaid/export')
        })
        expect(exportSvg).not.toHaveBeenCalled()

        // Once the text has rendered, the items turn back on.
        diagram.isStale = false
        view.rerender(<DocumentExportMenu />)
        expect(screen.getByRole('menuitem', { name: 'Save PNG' })).not.toHaveAttribute('aria-disabled')
        expect(screen.getByRole('menuitem', { name: 'Save PNG' })).not.toHaveAttribute('aria-busy')
        const enabled = screen.getByRole('menuitem', { name: 'Save SVG' })
        expect(enabled).not.toHaveAttribute('aria-disabled')
        expect(enabled).not.toHaveAttribute('aria-busy')
        expect(enabled.querySelector('svg.animate-spin')).toBeNull()
        fireEvent.click(enabled)
        await waitFor(() => expect(exportSvg).toHaveBeenCalledWith('graph TD; A-->', 'light', expect.objectContaining({ tabName: 'flow.mmd' })))
    })
})
