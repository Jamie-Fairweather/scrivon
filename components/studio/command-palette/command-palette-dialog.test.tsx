import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import { DEBOUNCE_MS } from '@/components/studio/command-palette/search-content'
import type { WorkspaceSearchOptions } from '@/components/studio/command-palette/text-matcher'
import type { ActionPaletteItem, PaletteItem } from '@/components/studio/command-palette/types'
import { notifyError } from '@/lib/notify'

const platform = vi.hoisted(() => ({ isMac: false }))

vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))
vi.mock('@/lib/settings/chord-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settings/chord-utils')>()),
    isMacPlatform: () => platform.isMac,
}))

type DialogProps = ComponentProps<typeof CommandPaletteDialog>

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

    it('uses the general placeholder, which names the prefixes, and no filter chip in the default mode', () => {
        renderDialog({ mode: 'all' })
        expect(screen.getByPlaceholderText('Search files and text · > commands · : line · @ heading · ? help')).toBeInTheDocument()
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
            previewMatchLength: 2,
            source: 'buffer',
        }
        renderDialog({ mode: 'text', query: 'aa', groups: [{ id: 'text', label: 'Text', items: [hit] }] })
        const option = screen.getByRole('option', { name: /a.md · 1:7/ })
        expect(option.querySelector('mark')?.textContent).toBe('aa')
    })

    it('highlights only the part of a long match that the preview shows', () => {
        const hit: PaletteItem = {
            kind: 'text',
            value: 'text:/ws/a.md:1:81',
            searchText: 'a.md',
            path: '/ws/a.md',
            name: 'a.md',
            relativePath: 'a.md',
            documentKind: 'markdown',
            line: 1,
            column: 81,
            length: 150,
            preview: `…${'M'.repeat(100)}…`,
            previewMatchStart: 1,
            previewMatchLength: 100,
            source: 'buffer',
        }
        renderDialog({ mode: 'text', query: 'M+', groups: [{ id: 'text', label: 'Text', items: [hit] }] })
        const option = screen.getByRole('option', { name: /a.md · 1:81/ })
        expect(option.querySelector('mark')?.textContent).toBe('M'.repeat(100))
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
            previewMatchLength: 5,
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
            previewMatchLength: 5,
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

describe('CommandPaletteDialog secondary text', () => {
    it("switches secondary lines to the highlighted row's text colour, so they stay readable on its fill", () => {
        const withDetail: ActionPaletteItem = { ...saveAll, value: 'action:recent', detail: 'C:\\work\\docs' }
        renderDialog({ groups: [{ id: 'mixed', label: 'Results', items: [withDetail, dirtyTab] }] })

        const secondary = screen.getAllByRole('option').flatMap((option) => [...option.querySelectorAll('span.text-muted-foreground')])
        // The detail and the reason it is off, and the tab's path.
        expect(secondary).toHaveLength(3)
        for (const span of secondary) expect(span).toHaveClass('in-data-highlighted:text-accent-foreground')
    })

    it('does not fade the status line below the muted text colour', () => {
        renderDialog({ mode: 'text', query: 'oauth', textCapped: true, textTruncatedFiles: 2, textUnreadableFiles: 1 })
        expect(document.querySelector('[class*="text-muted-foreground/"]')).toBeNull()
    })
})

describe('CommandPaletteDialog right-to-left names', () => {
    const LRM = '‎'

    it('keeps Hebrew folders in order in a path, and lets the name take its own direction', () => {
        const tab: PaletteItem = { ...dirtyTab, value: 'tab:hebrew', name: 'סיכום.md', relativePath: 'מסמכים/פרויקט/סיכום.md', isDirty: false }
        renderDialog({ groups: [{ id: 'tabs', label: 'Open Editors', items: [tab] }] })

        const option = screen.getByRole('option')
        expect(within(option).getByText(`${LRM}מסמכים/${LRM}פרויקט/${LRM}סיכום.md${LRM}`)).toBeInTheDocument()
        expect(within(option).getByText('סיכום.md')).toHaveAttribute('dir', 'auto')
    })

    it('sets a text hit apart from its folder and line, so a Hebrew name cannot pull them out of order', () => {
        const hit: PaletteItem = {
            kind: 'text',
            value: 'text:/ws/מסמכים/סיכום.md:4:1',
            searchText: 'סיכום.md',
            path: '/ws/מסמכים/סיכום.md',
            name: 'סיכום.md',
            relativePath: 'מסמכים/סיכום.md',
            documentKind: 'markdown',
            line: 4,
            column: 1,
            length: 3,
            preview: 'abc',
            previewMatchStart: 0,
            previewMatchLength: 3,
            source: 'disk',
        }
        renderDialog({ mode: 'text', query: 'abc', groups: [{ id: 'text', label: 'Text', items: [hit] }] })

        const option = screen.getByRole('option')
        expect(within(option).getByText('סיכום.md')).toHaveAttribute('dir', 'auto')
        expect(within(option).getByText(`${LRM}מסמכים${LRM}`, { exact: false })).toBeInTheDocument()
    })

    it('lets the search box follow the direction of what is typed', () => {
        renderDialog()
        expect(screen.getByRole('combobox')).toHaveAttribute('dir', 'auto')
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

    it('says whether an on/off command is on now, as the menus tick it', () => {
        const toggle = (label: string, checked: boolean): ActionPaletteItem => ({
            kind: 'action',
            value: `action:${label}`,
            searchText: '',
            label,
            checked,
            shortcut: 'Ctrl+B',
            run: () => {},
        })
        renderDialog({ query: '>', groups: [{ id: 'actions', label: 'Commands', items: [toggle('Explorer', true), toggle('Autosave', false)] }] })

        expect(screen.getByRole('option', { name: 'Explorer On Ctrl+B' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Autosave Off Ctrl+B' })).toBeInTheDocument()
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

describe('CommandPaletteDialog picking an item', () => {
    const openFolder: ActionPaletteItem = {
        kind: 'action',
        value: 'action:recent-workspace:C:\big',
        searchText: 'recent workspace big',
        label: 'Open Recent Folder: big',
        run: () => {},
    }
    const groups = [{ id: 'actions', label: 'Commands', items: [openFolder] }]

    it('closes before a slow item has finished, and ignores a second pick meanwhile', async () => {
        const onSelectItem = vi.fn(() => new Promise<void>(() => {}))
        const props = renderDialog({ query: '>big', groups, onSelectItem })
        const option = screen.getByRole('option', { name: /Open Recent Folder: big/ })

        fireEvent.click(option)
        fireEvent.click(option)

        expect(props.onOpenChange).toHaveBeenCalledWith(false)
        await waitFor(() => expect(onSelectItem).toHaveBeenCalledTimes(1))
        expect(onSelectItem).toHaveBeenCalledWith(openFolder)
    })

    it('says so when the item fails', async () => {
        const failure = new Error('boom')
        renderDialog({ query: '>big', groups, onSelectItem: vi.fn(async () => Promise.reject(failure)) })

        fireEvent.click(screen.getByRole('option', { name: /Open Recent Folder: big/ }))

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't run that", failure))
    })

    it('lets the user pick again once the palette is opened again', async () => {
        const onSelectItem = vi.fn()
        const props: DialogProps = {
            open: true,
            onOpenChange: vi.fn(),
            mode: 'all',
            onModeChange: vi.fn(),
            query: '>big',
            onQueryChange: vi.fn(),
            groups,
            isSearchingText: false,
            textCapped: false,
            textTruncatedFiles: 0,
            textUnreadableFiles: 0,
            hasWorkspace: true,
            onSelectItem,
        }
        const view = render(<CommandPaletteDialog {...props} />)
        fireEvent.click(screen.getByRole('option', { name: /Open Recent Folder: big/ }))
        await waitFor(() => expect(onSelectItem).toHaveBeenCalledTimes(1))

        view.rerender(<CommandPaletteDialog {...props} open={false} />)
        view.rerender(<CommandPaletteDialog {...props} open />)
        fireEvent.click(await screen.findByRole('option', { name: /Open Recent Folder: big/ }))

        await waitFor(() => expect(onSelectItem).toHaveBeenCalledTimes(2))
    })
})

describe('CommandPaletteDialog prefixes', () => {
    const lineItem: PaletteItem = {
        kind: 'line',
        value: 'line:12:5',
        searchText: 'Go to line 12, column 5',
        path: '/ws/notes.md',
        label: 'Go to line 12, column 5',
        detail: 'notes.md · 40 lines',
        line: 12,
        column: 5,
    }

    const headingItem = (text: string, level: number, depth: number, line: number): PaletteItem => ({
        kind: 'heading',
        value: `heading:${line}`,
        searchText: text,
        path: '/ws/guide.md',
        headingId: text.toLowerCase(),
        text,
        level,
        line,
        depth,
    })

    const help: PaletteItem[] = [
        { kind: 'prefix', value: 'prefix:>', searchText: '> Run a command', prefix: '>', label: 'Run a command' },
        { kind: 'prefix', value: 'prefix::', searchText: ': Go to a line', prefix: ':', label: 'Go to a line in the open file' },
    ]

    it('shows where : goes, in which file', () => {
        renderDialog({ query: ':12:5', groups: [{ id: 'line', label: 'Go to Line', items: [lineItem] }] })
        expect(screen.getByRole('option', { name: 'Go to line 12, column 5 notes.md · 40 lines' })).toBeInTheDocument()
    })

    it('sets headings in by level and shows their line', () => {
        const items = [headingItem('Install', 2, 0, 3), headingItem('Windows', 3, 1, 5)]
        renderDialog({ query: '@', groups: [{ id: 'headings', label: 'Headings', items }] })

        const indent = (name: RegExp) => parseFloat((screen.getByRole('option', { name }).firstElementChild as HTMLElement).style.paddingInlineStart)
        expect(indent(/^Install/)).toBe(0)
        expect(indent(/^Windows/)).toBe(12)
        expect(within(screen.getByRole('option', { name: /^Windows/ })).getByText('Windows')).toHaveAttribute('dir', 'auto')
    })

    it('tells screen readers the level that the indent shows', () => {
        const items = [headingItem('Install', 2, 0, 3), headingItem('Windows', 3, 1, 5)]
        renderDialog({ query: '@', groups: [{ id: 'headings', label: 'Headings', items }] })

        expect(screen.getByRole('option', { name: 'Install , level 2 Line 3' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Windows , level 3 Line 5' })).toBeInTheDocument()
    })

    it("names a diagram's parts and their lines", () => {
        const part = (type: string, name: string, line: number): PaletteItem => ({
            kind: 'diagram-part',
            value: `part:${type}:${name}`,
            searchText: `${type}: ${name}`,
            path: '/ws/flow.mmd',
            type,
            name,
            line,
            column: 3,
            length: 1,
        })
        renderDialog({
            query: '@',
            groups: [{ id: 'diagram-parts', label: 'Diagram Parts', items: [part('Node', 'Start', 3), part('Link', 'A → B', 5)] }],
        })

        expect(screen.getByRole('option', { name: 'Node: Start Line 3' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Link: A → B Line 5' })).toBeInTheDocument()
    })

    it('shows the hint for a prefix that lists nothing', () => {
        renderDialog({ query: ':', emptyHint: 'Type a line number from 1 to 40. Add :5 to go to a column.' })
        expect(screen.getByText(/^Type a line number from 1 to 40\./)).toBeInTheDocument()
    })

    it('types the prefix picked from the ? list and stays open', async () => {
        const onSelectItem = vi.fn()
        const onOpenChange = vi.fn()
        function Stateful() {
            const [query, setQuery] = useState('?')
            return (
                <CommandPaletteDialog
                    groups={query === '?' ? [{ id: 'help', label: 'Prefixes', items: help }] : []}
                    hasWorkspace
                    isSearchingText={false}
                    mode="all"
                    onModeChange={vi.fn()}
                    onOpenChange={onOpenChange}
                    onQueryChange={setQuery}
                    onSelectItem={onSelectItem}
                    open
                    query={query}
                    textCapped={false}
                    textTruncatedFiles={0}
                    textUnreadableFiles={0}
                />
            )
        }
        render(<Stateful />)
        const input = screen.getByRole('combobox')

        fireEvent.click(screen.getByRole('option', { name: /Go to a line in the open file/ }))

        await waitFor(() => expect(input).toHaveValue(':'))
        expect(input).toHaveFocus()
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(onSelectItem).not.toHaveBeenCalled()
    })

    it('points to > only while searching', () => {
        renderDialog({ query: '' })
        expect(screen.getByText('Commands', { selector: 'span' })).toBeInTheDocument()
    })

    it.each([':', '@', '?', '>'])('leaves out the > hint once %s is typed', (query) => {
        renderDialog({ query })
        expect(screen.queryByText('Commands', { selector: 'span' })).toBeNull()
    })
})

describe('CommandPaletteDialog Find in Workspace options', () => {
    const OFF: WorkspaceSearchOptions = { matchCase: false, wholeWord: false, useRegex: false }
    const hit = (line: number): PaletteItem => ({
        kind: 'text',
        value: `text:/ws/a.md:${line}:1`,
        searchText: 'a.md oauth /ws/a.md',
        path: '/ws/a.md',
        name: 'a.md',
        relativePath: 'a.md',
        documentKind: 'markdown',
        line,
        column: 1,
        length: 5,
        preview: 'oauth',
        previewMatchStart: 0,
        previewMatchLength: 5,
        source: 'disk',
    })

    /** The dialog with its options kept in state, as the provider keeps them in settings. */
    function renderWithOptions(overrides: Partial<DialogProps> = {}, initial: WorkspaceSearchOptions = OFF) {
        const changes: WorkspaceSearchOptions[] = []
        function WithOptions() {
            const [options, setOptions] = useState(initial)
            return (
                <CommandPaletteDialog
                    groups={[]}
                    hasWorkspace
                    isSearchingText={false}
                    mode="text"
                    onModeChange={vi.fn()}
                    onOpenChange={vi.fn()}
                    onQueryChange={vi.fn()}
                    onSearchOptionsChange={(next) => {
                        changes.push(next)
                        setOptions(next)
                    }}
                    onSelectItem={vi.fn()}
                    open
                    query="oauth"
                    searchOptions={options}
                    searchOptionsApply
                    textCapped={false}
                    textTruncatedFiles={0}
                    textUnreadableFiles={0}
                    {...overrides}
                />
            )
        }
        render(<WithOptions />)
        return changes
    }

    const toggle = (name: string) => screen.getByRole('button', { name })
    /** The palette's own status region (the empty message is a status too). */
    const status = () => document.querySelector<HTMLElement>('.sr-only[role="status"]')!
    /** A key press that isn't wrapped by Testing Library, so its default can be checked. */
    const pressKey = (target: Element, init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        act(() => {
            target.dispatchEvent(event)
        })
        return event
    }

    afterEach(() => {
        platform.isMac = false
        vi.useRealTimers()
    })

    it('shows three toggles under the search box, each with its name, state and key', async () => {
        renderWithOptions({}, { ...OFF, wholeWord: true })
        const group = screen.getByRole('group', { name: 'Search options' })
        expect(
            within(group)
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label'))
        ).toEqual(['Match Case', 'Match Whole Word', 'Use Regular Expression'])
        expect(toggle('Match Case')).toHaveAttribute('aria-pressed', 'false')
        expect(toggle('Match Whole Word')).toHaveAttribute('aria-pressed', 'true')
        expect(toggle('Match Case')).toHaveAttribute('aria-keyshortcuts', 'Alt+C')
        expect(toggle('Match Whole Word')).toHaveAttribute('aria-keyshortcuts', 'Alt+W')
        expect(toggle('Use Regular Expression')).toHaveAttribute('aria-keyshortcuts', 'Alt+R')

        act(() => toggle('Use Regular Expression').focus())
        expect(await screen.findByText('Use Regular Expression (Alt+R)')).toBeInTheDocument()
    })

    it('marks the on state with a fill and a border, not colour alone', () => {
        renderWithOptions({}, { ...OFF, matchCase: true })
        expect(toggle('Match Case').className).toMatch(/aria-pressed:border-ring/)
        expect(toggle('Match Case').className).toMatch(/aria-pressed:bg-ring/)
    })

    it('switches an option on click and keeps the keyboard in the search box', async () => {
        const changes = renderWithOptions()
        const input = screen.getByRole('combobox')
        await waitFor(() => expect(input).toHaveFocus())

        const button = toggle('Match Case')
        // A pointer press doesn't take focus from the search box.
        expect(fireEvent.mouseDown(button)).toBe(false)
        fireEvent.click(button)

        expect(changes).toEqual([{ ...OFF, matchCase: true }])
        expect(toggle('Match Case')).toHaveAttribute('aria-pressed', 'true')
        expect(input).toHaveFocus()
    })

    it('puts the toggles after the search box and the Text chip in the tab order', async () => {
        const user = userEvent.setup()
        renderWithOptions()
        const input = screen.getByRole('combobox')
        await waitFor(() => expect(input).toHaveFocus())

        const order: string[] = []
        for (let i = 0; i < 4; i++) {
            await user.tab()
            order.push(document.activeElement?.getAttribute('aria-label') ?? '')
        }
        expect(order).toEqual(['Text only. Show all results', 'Match Case', 'Match Whole Word', 'Use Regular Expression'])
    })

    it('switches the options with Alt+C, Alt+W and Alt+R, from the search box or a toggle', () => {
        const changes = renderWithOptions()
        const input = screen.getByRole('combobox')

        expect(pressKey(input, { key: 'c', code: 'KeyC', altKey: true }).defaultPrevented).toBe(true)
        expect(pressKey(toggle('Match Case'), { key: 'w', code: 'KeyW', altKey: true }).defaultPrevented).toBe(true)
        pressKey(input, { key: 'r', code: 'KeyR', altKey: true })

        expect(changes).toEqual([
            { ...OFF, matchCase: true },
            { ...OFF, matchCase: true, wholeWord: true },
            { matchCase: true, wholeWord: true, useRegex: true },
        ])
    })

    it('reads the keys on a Russian layout by the physical key', () => {
        const changes = renderWithOptions()
        pressKey(screen.getByRole('combobox'), { key: 'с', code: 'KeyC', altKey: true })
        expect(changes).toEqual([{ ...OFF, matchCase: true }])
    })

    it("leaves Polish AltGr+C to type 'ć', and does nothing while an IME is composing", () => {
        const changes = renderWithOptions()
        const input = screen.getByRole('combobox')
        // Windows reports AltGr as Ctrl+Alt.
        const altGr = pressKey(input, { key: 'ć', code: 'KeyC', altKey: true, ctrlKey: true })
        pressKey(input, { key: 'c', code: 'KeyC', altKey: true, isComposing: true })
        pressKey(input, { key: 'Process', code: 'KeyC', altKey: true })

        expect(changes).toEqual([])
        expect(altGr.defaultPrevented).toBe(false)
    })

    it('needs Cmd+Option on macOS, where Option+C reports ç', () => {
        platform.isMac = true
        const changes = renderWithOptions()
        const input = screen.getByRole('combobox')
        expect(toggle('Match Case')).toHaveAttribute('aria-keyshortcuts', 'Meta+Alt+C')

        pressKey(input, { key: 'ç', code: 'KeyC', altKey: true })
        const cmdOptionC = pressKey(input, { key: 'ç', code: 'KeyC', altKey: true, metaKey: true })
        expect(changes).toEqual([{ ...OFF, matchCase: true }])
        expect(cmdOptionC.defaultPrevented).toBe(true)
    })

    it('hides the row and ignores the keys where the options do not apply', () => {
        // The hook says so for the default list, after the Text chip is removed, and for a > query.
        const changes = renderWithOptions({ searchOptionsApply: false, query: '>save' })
        expect(screen.queryByRole('group', { name: 'Search options' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Match Case' })).toBeNull()

        const event = pressKey(screen.getByRole('combobox'), { key: 'c', code: 'KeyC', altKey: true })
        expect(changes).toEqual([])
        expect(event.defaultPrevented).toBe(false)
        expect(screen.getByRole('dialog')).not.toHaveAttribute('data-search-option-keys')
    })

    it('marks the popup while the options show, so the app leaves their keys to it', () => {
        renderWithOptions()
        expect(screen.getByRole('dialog')).toHaveAttribute('data-search-option-keys')
    })

    it('announces an option switched by key with the new result count', () => {
        renderWithOptions({ groups: [{ id: 'text', label: 'Text', items: [hit(1), hit(2)] }] })
        pressKey(screen.getByRole('combobox'), { key: 'c', code: 'KeyC', altKey: true })
        expect(status()).toHaveTextContent('Match Case on. 2 results')
        pressKey(screen.getByRole('combobox'), { key: 'c', code: 'KeyC', altKey: true })
        expect(status()).toHaveTextContent('Match Case off. 2 results')
        // A click is seen, so it isn't announced.
        fireEvent.click(toggle('Match Whole Word'))
        expect(status()).toHaveTextContent(/^2 results$/)
    })

    it('shows an invalid pattern under the search box, marks the box, and announces it once typing pauses', async () => {
        vi.useFakeTimers()
        renderWithOptions({ query: 'a(', queryError: 'Invalid regular expression: Unterminated group' }, { ...OFF, useRegex: true })
        const input = screen.getByRole('combobox')
        const message = screen.getByText('Invalid regular expression: Unterminated group')

        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(message.id)
        expect(screen.queryByText(/No text matches/)).toBeNull()
        expect(screen.queryByText(/Searching file contents/)).toBeNull()
        expect(status()).toHaveTextContent('')

        await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS))
        expect(status()).toHaveTextContent('Invalid regular expression: Unterminated group')
    })

    it('waits for the pause again when the same invalid pattern comes back', async () => {
        vi.useFakeTimers()
        const error = 'Invalid regular expression: Unterminated group'
        const props = (query: string, queryError: string | null): DialogProps => ({
            open: true,
            onOpenChange: vi.fn(),
            mode: 'text',
            onModeChange: vi.fn(),
            query,
            onQueryChange: vi.fn(),
            groups: [],
            isSearchingText: false,
            textCapped: false,
            textTruncatedFiles: 0,
            textUnreadableFiles: 0,
            hasWorkspace: true,
            onSelectItem: vi.fn(),
            searchOptions: { ...OFF, useRegex: true },
            onSearchOptionsChange: vi.fn(),
            searchOptionsApply: true,
            queryError,
        })
        const { rerender } = render(<CommandPaletteDialog {...props('a(', error)} />)
        await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS))
        expect(status()).toHaveTextContent(error)

        rerender(<CommandPaletteDialog {...props('a()', null)} />)
        expect(status()).not.toHaveTextContent(error)

        rerender(<CommandPaletteDialog {...props('a()(', error)} />)
        expect(status()).not.toHaveTextContent(error)
        await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS))
        expect(status()).toHaveTextContent(error)
    })

    it('says why a regex search stopped, in the footer and the status', () => {
        const stopped = 'Search stopped: the regular expression took too long on notes.md. Try a simpler pattern.'
        renderWithOptions({ textStopMessage: stopped, groups: [{ id: 'text', label: 'Text', items: [hit(1)] }] }, { ...OFF, useRegex: true })
        expect(status()).toHaveTextContent(`${stopped} 1 result`)
        expect(document.querySelector('[data-slot="search-note"]')).toHaveTextContent(stopped)
    })

    it.each([
        [{ textStopMessage: 'Search stopped.', textCapped: true, textLongLinesSkipped: 3, textTruncatedFiles: 2 }, 'Search stopped.'],
        [{ textCapped: true, textLongLinesSkipped: 3, textTruncatedFiles: 2 }, 'Showing first 100 matches — refine query'],
        [{ textLongLinesSkipped: 3, textTruncatedFiles: 2 }, '3 long lines skipped'],
        [{ textLongLinesSkipped: 1 }, '1 long line skipped'],
        [{ textTruncatedFiles: 2 }, 'Showing up to 10 matches per file'],
    ])('shows one search note at a time in the footer: %o', (overrides, note) => {
        renderWithOptions({ ...overrides, textUnreadableFiles: 1 })
        const notes = document.querySelectorAll('[data-slot="search-note"]')
        expect(notes).toHaveLength(1)
        expect(notes[0]).toHaveTextContent(note)
        // Beside it, as before.
        expect(screen.getByText("1 file couldn't be read")).toBeInTheDocument()
    })
})
