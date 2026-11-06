import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import type { ActionPaletteItem, PaletteItem } from '@/components/studio/command-palette/types'

type DialogProps = ComponentProps<typeof CommandPaletteDialog>

beforeAll(() => {
    // happy-dom has no Web Animations API, which Base UI's scroll area calls on a timer.
    if (typeof Element.prototype.getAnimations !== 'function') Element.prototype.getAnimations = () => []
})

function renderDialog(overrides: Partial<DialogProps> = {}) {
    const props: DialogProps = {
        open: true,
        onOpenChange: vi.fn(),
        mode: 'all',
        onModeChange: vi.fn(),
        query: '',
        onQueryChange: vi.fn(),
        groups: [],
        isSearchingText: false,
        textCapped: false,
        textTruncatedFiles: 0,
        textUnreadableFiles: 0,
        hasWorkspace: true,
        onSelectItem: vi.fn(),
        ...overrides,
    }
    render(<CommandPaletteDialog {...props} />)
    return props
}

describe('CommandPaletteDialog modes', () => {
    it('shows which mode is active in the placeholder', () => {
        renderDialog({ mode: 'files' })
        expect(screen.getByPlaceholderText('Go to file…')).toBeInTheDocument()
    })

    it('uses the general placeholder and no filter chip in the default mode', () => {
        renderDialog({ mode: 'all' })
        expect(screen.getByPlaceholderText('Search files, text, and commands…')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /show all results/i })).toBeNull()
    })

    it('shows a filter chip that switches back to all results', () => {
        const props = renderDialog({ mode: 'text' })
        expect(screen.getByPlaceholderText('Find in workspace…')).toBeInTheDocument()

        const chip = screen.getByRole('button', { name: 'Text only. Show all results' })
        fireEvent.click(chip)
        expect(props.onModeChange).toHaveBeenCalledWith('all')
    })

    it('removes the filter when Backspace is pressed in an empty box', () => {
        const props = renderDialog({ mode: 'files' })
        fireEvent.keyDown(screen.getByPlaceholderText('Go to file…'), { key: 'Backspace' })
        expect(props.onModeChange).toHaveBeenCalledWith('all')
    })

    it('keeps the filter when Backspace deletes typed text', () => {
        const props = renderDialog({ mode: 'files', query: 'readme' })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' })
        expect(props.onModeChange).not.toHaveBeenCalled()
    })

    it('keeps the filter while Backspace is held down after clearing the box', () => {
        const props = renderDialog({ mode: 'files' })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace', repeat: true })
        expect(props.onModeChange).not.toHaveBeenCalled()
    })

    it('explains that file contents need two characters in Find in Workspace', () => {
        renderDialog({ mode: 'text', query: 'a' })
        // Base UI briefly appends an invisible marker to the empty text, so match without anchoring the end.
        expect(screen.getByText(/^Type at least 2 characters to search file contents\./)).toBeInTheDocument()
    })

    it('explains that results are filtered when nothing matches in a narrowed mode', () => {
        renderDialog({ mode: 'text', query: 'readme' })
        expect(screen.getByText(/^No text matches\. Remove the Text filter to search file names too\./)).toBeInTheDocument()
    })
})

describe('CommandPaletteDialog pre-filled query', () => {
    it('selects a pre-filled query when it opens, so typing replaces it', async () => {
        renderDialog({ mode: 'text', query: 'flowchart' })
        const input = screen.getByRole<HTMLInputElement>('combobox')

        await waitFor(() => expect(input).toHaveFocus())
        expect(input.selectionStart).toBe(0)
        expect(input.selectionEnd).toBe('flowchart'.length)
    })
})

const saveAll: ActionPaletteItem = {
    kind: 'action',
    value: 'action:save-all',
    searchText: 'save all files',
    label: 'Save All',
    disabled: true,
    disabledReason: 'Nothing to save',
    run: () => {},
}

const dirtyTab: PaletteItem = {
    kind: 'tab',
    value: 'tab:/ws/notes.md',
    searchText: 'notes.md',
    path: '/ws/notes.md',
    name: 'notes.md',
    documentKind: 'markdown',
    isDirty: true,
}

describe('CommandPaletteDialog text results', () => {
    it('says when some files had more matches than shown', () => {
        renderDialog({ mode: 'text', query: '-->', textTruncatedFiles: 2 })
        expect(screen.getByText('Showing up to 10 matches per file')).toBeInTheDocument()
    })

    it('highlights the match each row stands for, not the first look-alike', () => {
        const hit: PaletteItem = {
            kind: 'text',
            value: 'text:/ws/a.md:1:7',
            searchText: 'a.md aa bb aa /ws/a.md',
            path: '/ws/a.md',
            name: 'a.md',
            documentKind: 'markdown',
            line: 1,
            column: 7,
            length: 2,
            preview: 'AA bb aa',
            previewMatchStart: 6,
            source: 'buffer',
        }
        renderDialog({ mode: 'text', query: 'aa', groups: [{ id: 'text', label: 'Text', items: [hit] }] })
        const option = screen.getByRole('option', { name: /a.md · 1:7/ })
        expect(option.querySelector('mark')?.textContent).toBe('aa')
    })
})

describe('CommandPaletteDialog icons', () => {
    it('shows the document icon for an upper-case .MD tab', () => {
        const tab: PaletteItem = { ...dirtyTab, value: 'tab:/ws/README.MD', path: '/ws/README.MD', name: 'README.MD', isDirty: false }
        renderDialog({ groups: [{ id: 'tabs', label: 'Open Editors', items: [tab] }] })
        const option = screen.getByRole('option', { name: /README.MD/ })
        expect(option.querySelector('.lucide-file-text')).not.toBeNull()
        expect(option.querySelector('.lucide-network')).toBeNull()
    })
})

describe('CommandPaletteDialog accessibility', () => {
    it('names the dialog and the search box', () => {
        renderDialog({ mode: 'files' })
        expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Go to file' })).toBeInTheDocument()
    })

    it('shows why a command is disabled in the row itself', () => {
        renderDialog({ query: '>save', groups: [{ id: 'actions', label: 'Commands', items: [saveAll] }] })
        expect(screen.getByRole('option', { name: /Save All.*Nothing to save/ })).toBeInTheDocument()
    })

    it('tells screen readers which open tabs have unsaved changes', () => {
        renderDialog({ groups: [{ id: 'tabs', label: 'Open Editors', items: [dirtyTab] }] })
        // Real text, not an aria-label on a plain span (which screen readers often skip).
        const option = screen.getByRole('option', { name: /notes\.md.*Unsaved changes/ })
        expect(within(option).getByText('Unsaved changes')).toBeInTheDocument()
    })

    it('announces how many results there are', () => {
        renderDialog({ groups: [{ id: 'tabs', label: 'Open Editors', items: [dirtyTab] }] })
        expect(screen.getByText('1 result')).toBeInTheDocument()
    })

    it('announces when file contents are still being searched', () => {
        renderDialog({ mode: 'text', query: 'oauth', isSearchingText: true })
        expect(screen.getByText('Searching file contents…')).toBeInTheDocument()
    })
})
