import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteDialog, type PaletteReplaceProps } from '@/components/studio/command-palette/command-palette-dialog'
import type { ReplacePlan } from '@/components/studio/command-palette/replace-content'
import type { PaletteGroup, TextPaletteItem } from '@/components/studio/command-palette/types'
import type { ReplaceAllState } from '@/components/studio/command-palette/use-palette-replace'

vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))

type DialogProps = ComponentProps<typeof CommandPaletteDialog>

function hit(path: string, line: number, newText = 'dog', overrides: Partial<TextPaletteItem> = {}): TextPaletteItem {
    const name = path.split('/').pop()!
    return {
        kind: 'text',
        value: `text:${path}:${line}:5`,
        searchText: `${name} the cat sat ${path}`,
        path,
        name,
        relativePath: path.replace('/ws/', ''),
        documentKind: 'markdown',
        line,
        column: 5,
        length: 3,
        preview: 'the cat sat',
        previewMatchStart: 4,
        previewMatchLength: 3,
        source: 'disk',
        newText,
        ...overrides,
    }
}

function fileGroup(path: string, items: TextPaletteItem[], capped = false): PaletteGroup {
    const name = path.split('/').pop()!
    const relative = path.replace('/ws/', '')
    const folder = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
    return { id: `replace:${path}`, label: name, items, file: { path, name, folder, matchCount: items.length, capped } }
}

const GROUPS: PaletteGroup[] = [
    fileGroup(
        '/ws/docs/notes.md',
        Array.from({ length: 10 }, (_, i) => hit('/ws/docs/notes.md', i + 1)),
        true
    ),
    fileGroup('/ws/b.md', [hit('/ws/b.md', 3)]),
]

function replaceProps(overrides: Partial<PaletteReplaceProps> = {}): PaletteReplaceProps {
    return {
        value: 'dog',
        onChange: vi.fn(),
        useRegex: false,
        busy: false,
        notice: null,
        dismissNotice: vi.fn(),
        replaceMatch: vi.fn(),
        replaceFile: vi.fn(),
        replaceAll: { phase: 'idle' },
        startReplaceAll: vi.fn(),
        confirmReplaceAll: vi.fn(),
        cancelReplaceAll: vi.fn(),
        ...overrides,
    }
}

function renderReplace(replace: Partial<PaletteReplaceProps> = {}, overrides: Partial<DialogProps> = {}) {
    const props: DialogProps = {
        open: true,
        onOpenChange: vi.fn(),
        mode: 'text',
        onModeChange: vi.fn(),
        query: 'cat',
        onQueryChange: vi.fn(),
        groups: GROUPS,
        isSearchingText: false,
        textCapped: false,
        textTruncatedFiles: 1,
        textUnreadableFiles: 0,
        hasWorkspace: true,
        onSelectItem: vi.fn(),
        searchOptionsApply: true,
        replace: replaceProps(replace),
        ...overrides,
    }
    const view = render(<CommandPaletteDialog {...props} />)
    return { props, replace: props.replace!, view }
}

const searchBox = () => screen.getByRole('combobox', { name: 'Find in workspace' })
const replaceBox = () => screen.getByRole('textbox', { name: 'Replace with' })
const status = () => document.querySelector<HTMLElement>('.sr-only[role="status"]')!

/** A key press that isn't wrapped by Testing Library, so its default and whether it got past can be checked. */
function pressKey(target: Element, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => {
        target.dispatchEvent(event)
    })
    return event
}

afterEach(() => {
    vi.clearAllMocks()
})

describe('Replace in Workspace box', () => {
    it('shows a Replace box under the search box, and none without replace', () => {
        const { view, props } = renderReplace()
        expect(replaceBox()).toHaveValue('dog')
        view.rerender(<CommandPaletteDialog {...props} replace={null} />)
        expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
    })

    it('passes what is typed on', () => {
        const onChange = vi.fn()
        renderReplace({ onChange })
        fireEvent.change(replaceBox(), { target: { value: 'bird' } })
        expect(onChange).toHaveBeenCalledWith('bird')
    })

    it('goes from the search box to the Replace box to the option toggles with Tab', async () => {
        renderReplace()
        const user = userEvent.setup()
        searchBox().focus()
        await user.tab()
        expect(replaceBox()).toHaveFocus()
        await user.tab()
        expect(screen.getByRole('button', { name: 'Match Case' })).toHaveFocus()
    })

    it('moves through the results with the arrow keys from the Replace box, and opens the selected match with Enter', async () => {
        const { props } = renderReplace()
        const box = replaceBox()
        box.focus()
        const first = searchBox().getAttribute('aria-activedescendant')
        fireEvent.keyDown(box, { key: 'ArrowDown' })
        const second = searchBox().getAttribute('aria-activedescendant')
        expect(second).toBeTruthy()
        expect(second).not.toBe(first)
        // The Replace box points at the same row, for screen readers.
        await waitFor(() => expect(box).toHaveAttribute('aria-activedescendant', second!))

        fireEvent.keyDown(box, { key: 'Enter' })
        await waitFor(() => expect(props.onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', line: 2 })))
    })
})

describe('Replace in Workspace results', () => {
    it("groups the matches by file, each heading with the file's name, folder and count, 10+ when capped", () => {
        renderReplace()
        const notes = screen.getByRole('group', { name: 'notes.md docs , 10+ matches, more than are listed' })
        const b = screen.getByRole('group', { name: 'b.md , 1 match' })
        expect(within(notes).getByText('10+')).toBeInTheDocument()
        expect(within(notes).getAllByRole('option')).toHaveLength(10)
        expect(within(b).getByText('1')).toBeInTheDocument()
    })

    it('strikes the old text through and marks the new, not by colour alone', () => {
        renderReplace()
        const row = screen.getAllByRole('option')[0]!
        expect(row.querySelector('del')).toHaveTextContent('cat')
        expect(row.querySelector('ins')).toHaveTextContent('dog')
        // A screen reader hears the change in words.
        expect(row).toHaveTextContent('the cat replaced with dog sat')
        // Both colours are theme tokens.
        expect(row.querySelector('del')!.className).toContain('text-destructive-foreground')
        expect(row.querySelector('ins')!.className).toContain('text-success-foreground')
    })

    it('says a match is deleted when the replacement is empty', () => {
        renderReplace({}, { groups: [fileGroup('/ws/b.md', [hit('/ws/b.md', 3, '')])] })
        expect(screen.getByRole('option')).toHaveTextContent('the cat replaced with nothing sat')
    })

    it('names each button by what it replaces, and replaces with it', () => {
        const { replace } = renderReplace()
        fireEvent.click(screen.getByRole('button', { name: 'Replace in notes.md' }))
        expect(replace.replaceFile).toHaveBeenCalledWith('/ws/docs/notes.md')

        fireEvent.click(screen.getByRole('button', { name: 'Replace line 3, column 5 in b.md' }))
        expect(replace.replaceMatch).toHaveBeenCalledWith(expect.objectContaining({ path: '/ws/b.md', line: 3 }))
    })

    it('never opens the match when its Replace button is pressed', async () => {
        const { props } = renderReplace()
        await userEvent.setup().click(screen.getByRole('button', { name: 'Replace line 3, column 5 in b.md' }))
        expect(props.onSelectItem).not.toHaveBeenCalled()
        expect(props.onOpenChange).not.toHaveBeenCalled()
    })

    it('greys out the buttons of results from an older search, so nothing stale is replaced', () => {
        const stale = [fileGroup('/ws/b.md', [hit('/ws/b.md', 3, 'dog', { disabled: true })])]
        stale[0]!.file!.disabled = true
        renderReplace({}, { groups: stale, isSearchingText: true })
        expect(screen.getByRole('button', { name: 'Replace in b.md' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Replace line 3, column 5 in b.md' })).toBeDisabled()
        expect(screen.getByRole('button', { name: /^Replace All/ })).toBeDisabled()
    })

    it('runs Replace All from its button', () => {
        const { replace } = renderReplace()
        fireEvent.click(screen.getByRole('button', { name: /^Replace All/ }))
        expect(replace.startReplaceAll).toHaveBeenCalled()
    })

    it('announces how many matches there are, and what the last replace did', () => {
        const { view, props } = renderReplace()
        expect(status()).toHaveTextContent('11+ matches in 2 files')
        view.rerender(<CommandPaletteDialog {...props} replace={replaceProps({ notice: { message: 'Replaced 3 matches in b.md.', details: [] } })} />)
        expect(status()).toHaveTextContent('Replaced 3 matches in b.md. 11+ matches in 2 files')
        expect(screen.getByText('Replaced 3 matches in b.md.')).toBeInTheDocument()
    })
})

describe('Replace in Workspace keys', () => {
    it('replaces the selected match with Ctrl+Shift+1, and keeps the key from anything else', () => {
        const { replace, props } = renderReplace()
        const onWindow = vi.fn()
        window.addEventListener('keydown', onWindow)
        fireEvent.keyDown(replaceBox(), { key: 'ArrowDown' })

        const event = pressKey(replaceBox(), { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })

        expect(event.defaultPrevented).toBe(true)
        expect(onWindow).not.toHaveBeenCalledWith(event)
        expect(replace.replaceMatch).toHaveBeenCalledWith(expect.objectContaining({ path: '/ws/docs/notes.md', line: 2 }))
        expect(props.onSelectItem).not.toHaveBeenCalled()
        window.removeEventListener('keydown', onWindow)
    })

    it('runs Replace All with Ctrl+Alt+Enter, from the search box too, without opening the selected match', () => {
        const { replace, props } = renderReplace()
        const event = pressKey(searchBox(), { key: 'Enter', ctrlKey: true, altKey: true })

        expect(event.defaultPrevented).toBe(true)
        expect(replace.startReplaceAll).toHaveBeenCalled()
        expect(props.onSelectItem).not.toHaveBeenCalled()
        expect(props.onOpenChange).not.toHaveBeenCalled()
    })

    it('leaves the keys alone without the Replace box', () => {
        renderReplace({}, { replace: null })
        const event = pressKey(searchBox(), { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })
        expect(event.defaultPrevented).toBe(false)
    })
})

describe('Replace All dialog', () => {
    const plan: ReplacePlan = {
        files: [
            ...Array.from({ length: 11 }, (_, i) => ({ path: `/ws/f${i}.md`, source: 'disk' as const, count: 3, signature: '' })),
            { path: '/ws/open.md', source: 'buffer', count: 1, signature: '' },
        ],
        totalMatches: 34,
        skipped: [{ path: '/ws/old.md', reason: 'encoding' }],
        longLinesSkipped: 0,
    }

    function renderState(replaceAll: ReplaceAllState, replace: Partial<PaletteReplaceProps> = {}) {
        return renderReplace({ replaceAll, ...replace })
    }

    it('asks with the true totals, and says what Ctrl+Z cannot undo', async () => {
        const { replace } = renderState({ phase: 'confirm', plan, matcher: null as never, replacement: 'dog' })
        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByRole('heading', { name: 'Replace 34 matches in 12 files?' })).toBeInTheDocument()
        expect(dialog).toHaveTextContent('11 files aren’t open in a tab, so they are saved straight away, and Ctrl+Z can’t undo them.')
        expect(dialog).toHaveTextContent('1 open file changes in its tab, where Ctrl+Z undoes it.')
        expect(dialog).toHaveTextContent("old.md: it isn't saved as UTF-8 or UTF-16")

        fireEvent.click(within(dialog).getByRole('button', { name: 'Replace All' }))
        expect(replace.confirmReplaceAll).toHaveBeenCalled()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(replace.cancelReplaceAll).toHaveBeenCalled()
    })

    it('shows how many files are done while it runs, and stops on Cancel or Escape', async () => {
        const { replace } = renderState({ phase: 'running', done: 3, total: 12, stopping: false })
        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByRole('heading', { name: 'Replacing…' })).toBeInTheDocument()
        expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
        expect(dialog).toHaveTextContent('3 files of 12')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(replace.cancelReplaceAll).toHaveBeenCalledTimes(1)
        await userEvent.setup().keyboard('{Escape}')
        expect(replace.cancelReplaceAll).toHaveBeenCalledTimes(2)
    })

    it('shows the count running, which Cancel stops', async () => {
        const { replace } = renderState({ phase: 'counting', done: 40, total: 300 })
        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByRole('heading', { name: 'Counting matches…' })).toBeInTheDocument()
        expect(dialog).toHaveTextContent('40 files of 300')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(replace.cancelReplaceAll).toHaveBeenCalled()
    })

    it('never replaces or switches an option behind it from keys pressed in it', async () => {
        const onSearchOptionsChange = vi.fn()
        const { replace } = renderReplace(
            { replaceAll: { phase: 'confirm', plan, matcher: null as never, replacement: 'dog' } },
            { onSearchOptionsChange }
        )
        const dialog = await screen.findByRole('alertdialog')
        // A match is highlighted in the results behind the dialog (hidden from screen readers while it shows).
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Find in workspace', hidden: true }), { key: 'ArrowDown' })
        const button = within(dialog).getByRole('button', { name: 'Replace All' })

        const replaceOne = pressKey(button, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })
        pressKey(button, { key: 'Enter', ctrlKey: true, altKey: true })
        pressKey(button, { key: 'c', code: 'KeyC', altKey: true })

        expect(replace.replaceMatch).not.toHaveBeenCalled()
        expect(replace.startReplaceAll).not.toHaveBeenCalled()
        expect(onSearchOptionsChange).not.toHaveBeenCalled()
        // Still kept from the app's own keys while the palette is open.
        expect(replaceOne.defaultPrevented).toBe(true)
    })

    it('keeps the Replace box and results usable around it: no dialog while idle', () => {
        renderState({ phase: 'idle' })
        expect(screen.queryByRole('alertdialog')).toBeNull()
    })
})

describe('Replace in Workspace with the options', () => {
    it('keeps state the provider owns in a wrapper, as the palette does', () => {
        function Wrapper() {
            const [value, setValue] = useState('')
            return (
                <CommandPaletteDialog
                    groups={GROUPS}
                    hasWorkspace
                    isSearchingText={false}
                    mode="text"
                    onModeChange={vi.fn()}
                    onOpenChange={vi.fn()}
                    onQueryChange={vi.fn()}
                    onSelectItem={vi.fn()}
                    open
                    query="cat"
                    replace={replaceProps({ value, onChange: setValue, useRegex: true })}
                    searchOptionsApply
                    textCapped={false}
                    textTruncatedFiles={0}
                    textUnreadableFiles={0}
                />
            )
        }
        render(<Wrapper />)
        fireEvent.change(replaceBox(), { target: { value: '$1' } })
        expect(replaceBox()).toHaveValue('$1')
        expect(replaceBox()).toHaveAccessibleDescription(/\$1 or \$<name> for a group/)
    })
})
