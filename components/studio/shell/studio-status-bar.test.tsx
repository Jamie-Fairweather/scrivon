import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorCursor, type EditorCursor } from '@/components/studio/editor/editor-cursor'
import { registerEditorFocus } from '@/components/studio/editor/editor-focus'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentSave, useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import type { DocumentTab } from '@/lib/workspace/types'
import { StudioStatusBar } from './studio-status-bar'

vi.mock('@/components/studio/editor/editor-cursor', () => ({ useEditorCursor: vi.fn() }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: vi.fn(),
    useDocumentSave: vi.fn(),
    useStudioLayout: vi.fn(),
}))

const flushSave = vi.fn<(id: string) => Promise<boolean>>()

function tab(overrides: Partial<DocumentTab> = {}): DocumentTab {
    return {
        id: 'C:\\ws\\notes.md',
        path: 'C:\\ws\\notes.md',
        name: 'notes.md',
        content: '# Notes\r\n\r\nSome words here.\r\n',
        isDirty: false,
        isSaving: false,
        format: { encoding: 'utf-8', bom: false },
        ...overrides,
    }
}

function show({
    activeTab = tab(),
    cursor = { line: 3, column: 6, selectedText: '' },
    editorOpen = true,
    visible = true,
}: { activeTab?: DocumentTab | null; cursor?: EditorCursor | null; editorOpen?: boolean; visible?: boolean } = {}) {
    vi.mocked(useDocumentTabs).mockReturnValue({ activeTab } as unknown as ReturnType<typeof useDocumentTabs>)
    vi.mocked(useEditorCursor).mockReturnValue(cursor)
    vi.mocked(useStudioLayout).mockReturnValue({ layout: { explorerOpen: true, editorOpen } } as unknown as ReturnType<typeof useStudioLayout>)
    vi.mocked(useAppSettings).mockReturnValue({ settings: { statusBar: { visible } } } as unknown as ReturnType<typeof useAppSettings>)
}

const statusBar = () => screen.getByRole('contentinfo', { name: 'Status bar' })

beforeEach(() => {
    vi.clearAllMocks()
    flushSave.mockResolvedValue(true)
    vi.mocked(useDocumentSave).mockReturnValue({ flushSave } as unknown as ReturnType<typeof useDocumentSave>)
})

describe('StudioStatusBar', () => {
    it('shows where the caret is, the counts, the line endings, the encoding and that the file is saved', () => {
        show()
        render(<StudioStatusBar />)

        const bar = within(statusBar())
        expect(bar.getByText('Saved')).toBeInTheDocument()
        expect(bar.getByText('Ln 3, Col 6')).toBeInTheDocument()
        expect(bar.getByText('4 words')).toBeInTheDocument()
        expect(bar.getByText('23 characters')).toBeInTheDocument()
        expect(bar.getByText('CRLF')).toBeInTheDocument()
        expect(bar.getByText('UTF-8')).toBeInTheDocument()
    })

    it('counts the selection, out of the whole file, while text is selected', () => {
        show({ cursor: { line: 3, column: 11, selectedText: 'Some words' } })
        render(<StudioStatusBar />)

        const bar = within(statusBar())
        expect(bar.getByText('2 of 4 words')).toBeInTheDocument()
        expect(bar.getByText('10 of 23 characters')).toBeInTheDocument()
    })

    it('leaves out the caret and the selection while the editor is hidden', () => {
        show({ editorOpen: false, cursor: { line: 3, column: 11, selectedText: 'Some words' } })
        render(<StudioStatusBar />)

        const bar = within(statusBar())
        expect(bar.queryByText(/^Ln /)).not.toBeInTheDocument()
        expect(bar.getByText('4 words')).toBeInTheDocument()
        expect(bar.getByText('23 characters')).toBeInTheDocument()
    })

    it('says when the file has unsaved changes, is being saved, or is read-only', () => {
        show({ activeTab: tab({ isDirty: true }) })
        const { rerender } = render(<StudioStatusBar />)
        expect(within(statusBar()).getByText('Unsaved')).toBeInTheDocument()

        // A save that runs again after a failure says it is saving, not that it failed.
        show({ activeTab: tab({ isDirty: true, isSaving: true, saveError: 'Access is denied.' }) })
        rerender(<StudioStatusBar />)
        expect(within(statusBar()).getByText('Saving…')).toBeInTheDocument()

        show({ activeTab: tab({ readOnly: true }) })
        rerender(<StudioStatusBar />)
        expect(within(statusBar()).getByText('Read-only')).toBeInTheDocument()
    })

    it('makes a failed save stand out, and clicking it shows why and tries again', async () => {
        const user = userEvent.setup()
        const focusEditor = vi.fn()
        const unregister = registerEditorFocus(focusEditor)
        show({ activeTab: tab({ isDirty: true, saveError: 'Access is denied.' }) })
        render(<StudioStatusBar />)

        await user.click(within(statusBar()).getByRole('button', { name: 'Save failed' }))
        const details = await screen.findByRole('dialog', { name: "Couldn't save notes.md" })
        expect(details).toHaveTextContent('Access is denied.')

        await user.click(within(details).getByRole('button', { name: 'Try Again' }))
        expect(flushSave).toHaveBeenCalledWith('C:\\ws\\notes.md')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        // "Save failed" turns into "Saving…" at once, so the keyboard goes back to the file instead of being lost.
        expect(focusEditor).toHaveBeenCalledWith('C:\\ws\\notes.md')
        unregister()
    })

    it('names how the file is stored', () => {
        const encodingOf = (overrides: Partial<DocumentTab>) => {
            show({ activeTab: tab(overrides) })
            const { unmount } = render(<StudioStatusBar />)
            const text = statusBar().textContent
            unmount()
            return text
        }
        expect(encodingOf({ format: { encoding: 'utf-8', bom: true } })).toContain('UTF-8 with BOM')
        expect(encodingOf({ format: { encoding: 'utf-16le', bom: true } })).toContain('UTF-16 LE')
        expect(encodingOf({ format: { encoding: 'utf-16be', bom: true } })).toContain('UTF-16 BE')
        expect(encodingOf({ format: undefined })).toContain('UTF-8')
        // Shown, read-only, as Windows-1252 (see the read-only bar).
        expect(encodingOf({ readOnly: true, encodingIssue: 'legacy-encoding' })).toContain('Windows-1252')
        // Not text Scrivon can read, or not a file at all: nothing to name.
        expect(encodingOf({ readOnly: true, encodingIssue: 'binary' })).not.toMatch(/UTF|Windows/)
        expect(encodingOf({ id: 'example:flowchart', path: 'example:flowchart', readOnly: true, format: undefined })).not.toMatch(/UTF/)
    })

    it('says when a file mixes line endings', () => {
        show({ activeTab: tab({ content: 'a\r\nb\nc' }) })
        render(<StudioStatusBar />)
        expect(within(statusBar()).getByText('Mixed line endings')).toBeInTheDocument()
    })

    it('shows an empty bar with no file open, and no bar once the setting hides it', () => {
        show({ activeTab: null, cursor: null })
        const { rerender, container } = render(<StudioStatusBar />)
        expect(statusBar()).toBeEmptyDOMElement()

        show({ visible: false })
        rerender(<StudioStatusBar />)
        expect(container).toBeEmptyDOMElement()
    })

    it('says "1 word" rather than "1 words"', () => {
        show({ activeTab: tab({ content: 'Hi' }), cursor: null })
        render(<StudioStatusBar />)

        const bar = within(statusBar())
        expect(bar.getByText('1 word')).toBeInTheDocument()
        expect(bar.getByText('2 characters')).toBeInTheDocument()
        // No line break, so no line ending to name.
        expect(bar.queryByText(/^(CRLF|LF)$/)).not.toBeInTheDocument()
    })
})
