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

    it('asks for a query when Find in Workspace opens empty', () => {
        renderDialog({ mode: 'text', query: '' })
        // Base UI briefly appends an invisible marker to the empty text, so match without anchoring the end.
        expect(screen.getByText(/^Type to search file contents\./)).toBeInTheDocument()
    })

    it('does not ask for more characters after one character in Find in Workspace', () => {
        renderDialog({ mode: 'text', query: '図' })
        expect(screen.getByText(/^No text matches\./)).toBeInTheDocument()
    })

    it('says commands are what found nothing in > mode', () => {
        renderDialog({ query: '>zzz' })
        expect(screen.getByText(/^No matching commands\./)).toBeInTheDocument()
    })

    it('says commands found nothing in > mode even with no folder open', () => {
        renderDialog({ query: '>zzz', hasWorkspace: false })
        expect(screen.getByText(/^No matching commands\./)).toBeInTheDocument()
    })

    it('says file contents are still being searched instead of "no results"', () => {
        renderDialog({ mode: 'all', query: 'xy', isSearchingText: true })
        expect(screen.getByText(/^Searching file contents…/)).toBeInTheDocument()
        expect(screen.queryByText(/No results/)).toBeNull()
    })

    it('does not suggest > when commands are already part of the results', () => {
        renderDialog({ mode: 'all', query: 'zzzz' })
        expect(screen.getByText(/^No results found\. Try a shorter query\./)).toBeInTheDocument()
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
    relativePath: 'notes.md',
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
            relativePath: 'a.md',
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

    it("can't open a hit from the last search while a new one runs", () => {
        const hit: PaletteItem = {
            kind: 'text',
            value: 'text:/ws/a.md:1:1',
            searchText: 'a.md oauth /ws/a.md',
            path: '/ws/a.md',
            name: 'a.md',
            relativePath: 'a.md',
            documentKind: 'markdown',
            line: 1,
            column: 1,
            length: 5,
            preview: 'oauth',
            previewMatchStart: 0,
            source: 'disk',
            disabled: true,
        }
        const props = renderDialog({ mode: 'text', query: 'oauth f', isSearchingText: true, groups: [{ id: 'text', label: 'Text', items: [hit] }] })
        const option = screen.getByRole('option', { name: /a.md · 1:1/ })
        expect(option).toHaveAttribute('aria-disabled', 'true')

        fireEvent.click(option)
        expect(props.onSelectItem).not.toHaveBeenCalled()
    })
})

describe('CommandPaletteDialog same-named files', () => {
    function textHit(relativePath: string): PaletteItem {
        return {
            kind: 'text',
            value: `text:/ws/${relativePath}:1:3`,
            searchText: relativePath,
            path: `/ws/${relativePath}`,
            name: 'README.md',
            relativePath,
            documentKind: 'markdown',
            line: 1,
            column: 3,
            length: 5,
            preview: '# oauth',
            previewMatchStart: 2,
            source: 'disk',
        }
    }

    it('shows the folder of each text hit', () => {
        const items = [textHit('docs/README.md'), textHit('api/README.md')]
        renderDialog({ mode: 'text', query: 'oauth', groups: [{ id: 'text', label: 'Text', items }] })
        expect(screen.getByRole('option', { name: /^README\.md docs · 1:3/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /^README\.md api · 1:3/ })).toBeInTheDocument()
    })

    it("shows each open tab's path inside the workspace", () => {
        const tab = (relativePath: string): PaletteItem => ({ ...dirtyTab, value: `tab:${relativePath}`, relativePath, isDirty: false })
        renderDialog({ groups: [{ id: 'tabs', label: 'Open Editors', items: [tab('docs/notes.md'), tab('api/notes.md')] }] })
        expect(screen.getByRole('option', { name: /docs\/notes\.md/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /api\/notes\.md/ })).toBeInTheDocument()
    })

    it('shows the full path of a recent folder command', () => {
        const recent: ActionPaletteItem = {
            kind: 'action',
            value: 'action:recent-workspace:C:\\work\\docs',
            searchText: 'recent workspace docs',
            label: 'Open Recent Folder: docs',
            detail: 'C:\\work\\docs',
            run: () => {},
        }
        renderDialog({ query: '>docs', groups: [{ id: 'actions', label: 'Commands', items: [recent] }] })
        expect(screen.getByRole('option', { name: /Open Recent Folder: docs.*C:\\work\\docs/ })).toBeInTheDocument()
    })
})

describe('CommandPaletteDialog icons', () => {
    it('shows the document icon for an upper-case .MD tab', () => {
        const tab: PaletteItem = {
            ...dirtyTab,
            value: 'tab:/ws/README.MD',
            path: '/ws/README.MD',
            name: 'README.MD',
            relativePath: 'README.MD',
            isDirty: false,
        }
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
        renderDialog({ mode: 'all', query: 'notes', isSearchingText: true, groups: [{ id: 'tabs', label: 'Open Editors', items: [dirtyTab] }] })
        expect(screen.getByText('Searching file contents…')).toBeInTheDocument()
    })

    it('announces searching only once while nothing has matched yet', () => {
        renderDialog({ mode: 'text', query: 'oauth', isSearchingText: true })
        expect(screen.getAllByText(/^Searching file contents…/)).toHaveLength(1)
    })
})
