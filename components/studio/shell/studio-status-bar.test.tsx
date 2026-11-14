import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorCursor, type EditorCursor } from '@/components/studio/editor/editor-cursor'
import { registerEditorFocus } from '@/components/studio/editor/editor-focus'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentSave, useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { LARGE_FILE_BYTES } from '@/lib/workspace/document-tab'
import type { DocumentTab } from '@/lib/workspace/types'
import { StudioStatusBar } from './studio-status-bar'

vi.mock('@/components/studio/editor/editor-cursor', () => ({ useEditorCursor: vi.fn() }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: vi.fn(),
    useDocumentSave: vi.fn(),
    useStudioLayout: vi.fn(),
}))

const retrySave = vi.fn<(id: string) => Promise<boolean>>()

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
    retrySave.mockResolvedValue(true)
    vi.mocked(useDocumentSave).mockReturnValue({ retrySave } as unknown as ReturnType<typeof useDocumentSave>)
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

        const button = within(statusBar()).getByRole('button', { name: 'Save failed' })
        // The reason also shows on hover, as it does on the tab.
        expect(button).toHaveAttribute('title', 'Access is denied.')
        await user.click(button)
        const details = await screen.findByRole('dialog', { name: "Couldn't save notes.md" })
        expect(details).toHaveTextContent('Access is denied.')

        await user.click(within(details).getByRole('button', { name: 'Try Again' }))
        // The same retry as the notice's Try Again, so a new failure gets a new notice.
        expect(retrySave).toHaveBeenCalledWith('C:\\ws\\notes.md')
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

    it('leaves out the counts for a very large file, as counting it after every edit would be slow', () => {
        const big = `${'word '.repeat(Math.ceil(LARGE_FILE_BYTES / 5))}\n`
        show({ activeTab: tab({ content: big }), cursor: { line: 1, column: 6, selectedText: 'word ' } })
        render(<StudioStatusBar />)

        const bar = within(statusBar())
        expect(bar.queryByText(/words?$/)).not.toBeInTheDocument()
        expect(bar.queryByText(/characters?$/)).not.toBeInTheDocument()
        // The rest is still there.
        expect(bar.getByText('Ln 1, Col 6')).toBeInTheDocument()
        expect(bar.getByText('LF')).toBeInTheDocument()
    })

    describe('while typing', () => {
        beforeEach(() => {
            vi.useFakeTimers()
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        it('counts a small file again as soon as it changes', () => {
            show({ activeTab: tab({ content: 'one two' }) })
            const { rerender } = render(<StudioStatusBar />)
            expect(within(statusBar()).getByText('2 words')).toBeInTheDocument()

            show({ activeTab: tab({ content: 'one two three' }) })
            rerender(<StudioStatusBar />)
            // Within a frame.
            act(() => vi.advanceTimersByTime(20))
            expect(within(statusBar()).getByText('3 words')).toBeInTheDocument()
        })

        it('waits for a pause in typing before counting a large file again', () => {
            // Large enough to be slow to count on every key, but still small enough to edit.
            const big = 'word '.repeat(50_000)
            show({ activeTab: tab({ content: big }) })
            const { rerender } = render(<StudioStatusBar />)
            expect(within(statusBar()).getByText('50,000 words')).toBeInTheDocument()

            // Three keys, each sooner than the pause: the counts wait.
            for (const typed of ['a', 'a b', 'a b c']) {
                show({ activeTab: tab({ content: `${big}${typed}` }) })
                rerender(<StudioStatusBar />)
                act(() => vi.advanceTimersByTime(100))
                expect(within(statusBar()).getByText('50,000 words')).toBeInTheDocument()
            }

            // Once typing stops, the counts are right.
            act(() => vi.advanceTimersByTime(1000))
            expect(within(statusBar()).getByText('50,003 words')).toBeInTheDocument()
            expect(within(statusBar()).getByText('250,005 characters')).toBeInTheDocument()
        })

        it('counts a large file at once when switching to it', () => {
            show({ activeTab: tab({ content: 'one two' }) })
            const { rerender } = render(<StudioStatusBar />)

            const big = 'word '.repeat(50_000)
            show({ activeTab: tab({ id: 'C:\\ws\\big.md', path: 'C:\\ws\\big.md', name: 'big.md', content: big }) })
            rerender(<StudioStatusBar />)
            expect(within(statusBar()).getByText('50,000 words')).toBeInTheDocument()
        })

        it('counts a small selection again as soon as it changes', () => {
            show({ activeTab: tab({ content: 'one two three' }), cursor: { line: 1, column: 4, selectedText: 'one' } })
            const { rerender } = render(<StudioStatusBar />)
            expect(within(statusBar()).getByText('1 of 3 words')).toBeInTheDocument()

            show({ activeTab: tab({ content: 'one two three' }), cursor: { line: 1, column: 8, selectedText: 'one two' } })
            rerender(<StudioStatusBar />)
            act(() => vi.advanceTimersByTime(20))
            expect(within(statusBar()).getByText('2 of 3 words')).toBeInTheDocument()
        })

        it('waits for a pause before counting a large selection again', () => {
            const big = 'word '.repeat(50_000)
            const select = (selectedText: string) => show({ activeTab: tab({ content: big }), cursor: { line: 1, column: 1, selectedText } })
            select('')
            const { rerender } = render(<StudioStatusBar />)

            // Select all, then Shift+Up a few times, each sooner than the pause: the selection isn't counted yet.
            for (const words of [50_000, 49_990, 49_980]) {
                select('word '.repeat(words))
                rerender(<StudioStatusBar />)
                act(() => vi.advanceTimersByTime(100))
                expect(within(statusBar()).getByText('50,000 words')).toBeInTheDocument()
            }

            // Once selecting stops, it is.
            act(() => vi.advanceTimersByTime(1000))
            expect(within(statusBar()).getByText('49,980 of 50,000 words')).toBeInTheDocument()
            expect(within(statusBar()).getByText('249,900 of 250,000 characters')).toBeInTheDocument()

            // Clearing the selection shows at once.
            select('')
            rerender(<StudioStatusBar />)
            act(() => vi.advanceTimersByTime(20))
            expect(within(statusBar()).getByText('50,000 words')).toBeInTheDocument()
        })

        it('never shows more selected than the file holds when selecting all just after typing', () => {
            const big = 'word '.repeat(50_000)
            show({ activeTab: tab({ content: big }) })
            const { rerender } = render(<StudioStatusBar />)

            const typed = `${big}a b c`
            show({ activeTab: tab({ content: typed }) })
            rerender(<StudioStatusBar />)
            act(() => vi.advanceTimersByTime(100))

            // Ctrl+A before the file has been counted again.
            show({ activeTab: tab({ content: typed }), cursor: { line: 1, column: 1, selectedText: typed } })
            rerender(<StudioStatusBar />)
            for (let waited = 0; waited < 1000; waited += 50) {
                act(() => vi.advanceTimersByTime(50))
                expect(within(statusBar()).queryByText('50,003 of 50,000 words')).not.toBeInTheDocument()
            }
            expect(within(statusBar()).getByText('50,003 of 50,003 words')).toBeInTheDocument()
        })
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
