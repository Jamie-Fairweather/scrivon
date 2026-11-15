import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { IPosition, editor } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useEditorCommands } from '@/components/studio/editor/editor-commands'
import { listenForEditorContextMenu } from '@/lib/monaco/editor-context-menu'
import type { MisspeltWord } from '@/lib/monaco/spellcheck'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { EditorContextMenu } from './editor-context-menu'

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))

type KeyListener = (e: { browserEvent: { key: string }; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) => void
type Range = { start: number; end: number }

/**
 * Just what the menu uses of a Monaco editor, with real DOM nodes to right-click: one line of text, ten
 * pixels a letter and twenty high, with the line numbers left of x = 0. Monaco's text input (focused
 * while typing) and the find box are elements of their own.
 */
class FakeEditor {
    readonly container = document.createElement('div')
    readonly text = document.createElement('span')
    readonly input = document.createElement('div')
    readonly findBox = document.createElement('textarea')
    position: IPosition = { lineNumber: 1, column: 1 }
    /** Columns on line 1. */
    selection: Range | null = null
    readonly triggered: string[] = []
    private readonly keyListeners = new Set<KeyListener>()
    constructor() {
        const view = document.createElement('div')
        view.className = 'monaco-editor'
        this.input.tabIndex = 0
        const overlays = document.createElement('div')
        overlays.className = 'overlayWidgets'
        overlays.append(this.findBox)
        view.append(this.text, this.input, overlays)
        this.container.append(view)
        document.body.append(this.container)
        // What Monaco itself does on a right-click with its own menu off: take focus, and move the caret to the
        // place under the event's point.
        view.addEventListener('contextmenu', (e) => {
            this.focus()
            const hit = this.getTargetAtClientPoint(e.clientX, e.clientY)
            if (!this.getSelections()[0]!.containsPosition(hit.position)) this.setPosition(hit.position)
        })
    }
    getContainerDomNode() {
        return this.container
    }
    getDomNode() {
        return this.container.firstElementChild as HTMLElement
    }
    getModel() {
        return {}
    }
    getTargetAtClientPoint(x: number, y: number) {
        // 3 is Monaco's MouseTargetType for the line numbers, 6 for the text.
        if (x < 0) return { type: 3, position: { lineNumber: 1, column: 1 } }
        return { type: 6, position: { lineNumber: 1 + Math.floor(y / 20), column: 1 + Math.floor(x / 10) } }
    }
    getPosition() {
        return this.position
    }
    setPosition(position: IPosition) {
        this.position = position
        this.selection = null
    }
    getSelections() {
        const range = this.selection ?? { start: this.position.column, end: this.position.column }
        return [{ containsPosition: (p: IPosition) => p.lineNumber === 1 && range.start <= p.column && p.column <= range.end }]
    }
    focus() {
        this.input.focus()
    }
    hasTextFocus() {
        return document.activeElement === this.input
    }
    revealPosition() {}
    render() {}
    getScrolledVisiblePosition(position: IPosition) {
        return { left: (position.column - 1) * 10, top: (position.lineNumber - 1) * 20, height: 20 }
    }
    onKeyDown(listener: KeyListener) {
        this.keyListeners.add(listener)
        return { dispose: () => this.keyListeners.delete(listener) }
    }
    trigger(_source: string, id: string) {
        this.triggered.push(id)
    }
    /** A key pressed while the editor has focus. Returns whether something took it. */
    press(key: string, { shift = false } = {}) {
        const taken = { prevented: false }
        const e = {
            browserEvent: { key },
            shiftKey: shift,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            preventDefault: () => (taken.prevented = true),
            stopPropagation: () => {},
        }
        act(() => this.keyListeners.forEach((l) => l(e)))
        return taken.prevented
    }
    remove() {
        this.container.remove()
    }
}

/** 'helo' at columns 1-5 is misspelt; the suggestions come when the test says. */
function fakeSpelling() {
    const asked: { resolve: (suggestions: string[]) => void }[] = []
    const replaced: string[] = []
    const added: string[] = []
    const word: MisspeltWord = {
        word: 'helo',
        suggestions: () => new Promise((resolve) => asked.push({ resolve })),
        replaceWith: (suggestion) => replaced.push(suggestion),
        addToDictionary: () => added.push('helo'),
    }
    const misspeltWordAt = vi.fn((position: IPosition) => (position.lineNumber === 1 && position.column <= 5 ? word : null))
    /** Answers the oldest question still waiting. */
    const answer = async (suggestions: string[]) => {
        await act(async () => asked.shift()!.resolve(suggestions))
    }
    return { misspeltWordAt, answer, asked, replaced, added }
}

const openPalette = vi.fn()
const PALETTE_COMMANDS: AppCommand[] = [{ id: 'command-palette', label: 'Command Palette…', keybind: 'palette.open', run: openPalette }]

function Commands({ codeEditor, readOnly }: { codeEditor: FakeEditor; readOnly: boolean }) {
    useEditorCommands(codeEditor as unknown as editor.ICodeEditor, { shown: true, readOnly, markdown: true })
    useRegisterCommands(PALETTE_COMMANDS)
    return null
}

function setup({ readOnly = false } = {}) {
    const fake = new FakeEditor()
    const spelling = fakeSpelling()
    const view = render(
        <CommandRegistryProvider>
            <Commands codeEditor={fake} readOnly={readOnly} />
            <EditorContextMenu editor={fake as unknown as editor.ICodeEditor} readOnly={readOnly} misspeltWordAt={spelling.misspeltWordAt} />
        </CommandRegistryProvider>
    )
    return { fake, spelling, view }
}

/** The open menu's rows, with '---' for each line between groups. */
function menuRows() {
    const menu = screen.getByRole('menu')
    return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
        row.getAttribute('role') === 'separator' ? '---' : `${row.textContent}${row.hasAttribute('data-disabled') ? ' (off)' : ''}`
    )
}

const EVERYDAY_ROWS = ['CutCtrl+X', 'CopyCtrl+C', 'PasteCtrl+V', '---', 'Change All OccurrencesCtrl+F2', 'Command Palette…F1']

let fake: FakeEditor | undefined
afterEach(() => fake?.remove())
beforeEach(() => openPalette.mockClear())

describe('EditorContextMenu', () => {
    it('opens at the mouse on a misspelt word, and fills in the suggestions when they come', async () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })

        expect(screen.getByRole('menu')).toBeInTheDocument()
        expect(menuRows()).toEqual(['Looking for suggestions… (off)', '---', 'Add to Dictionary', '---', ...EVERYDAY_ROWS])

        await setUp.spelling.answer(['help', 'hello', 'halo'])
        expect(menuRows()).toEqual(['help', 'hello', 'halo', '---', 'Add to Dictionary', '---', ...EVERYDAY_ROWS])
        expect(within(screen.getByRole('menu')).getByRole('group', { name: 'Suggestions for “helo”' })).toBeInTheDocument()
    })

    it('puts the caret where the mouse is first, unless that is inside the selection', () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        expect(fake.position).toEqual({ lineNumber: 1, column: 3 })
        expect(setUp.spelling.misspeltWordAt).toHaveBeenLastCalledWith({ lineNumber: 1, column: 3 })
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

        fake.selection = { start: 7, end: 12 }
        fireEvent.contextMenu(fake.text, { clientX: 85, clientY: 5 })
        expect(fake.selection).toEqual({ start: 7, end: 12 })
        expect(setUp.spelling.misspeltWordAt).toHaveBeenLastCalledWith({ lineNumber: 1, column: 9 })
    })

    it('replaces the word with the suggestion chosen, and gives the editor back the keyboard', async () => {
        const setUp = setup()
        fake = setUp.fake
        fake.focus()
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        await setUp.spelling.answer(['help', 'hello'])

        fireEvent.click(screen.getByRole('menuitem', { name: 'hello' }))
        expect(setUp.spelling.replaced).toEqual(['hello'])
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
        expect(fake.input).toHaveFocus()
    })

    it('adds the word to the dictionary', () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Dictionary' }))
        expect(setUp.spelling.added).toEqual(['helo'])
    })

    it('says so when the dictionary has no suggestions', async () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        await setUp.spelling.answer([])
        expect(menuRows().slice(0, 3)).toEqual(['No suggestions (off)', '---', 'Add to Dictionary'])
    })

    it('has no spelling rows on a word that is spelt right', () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 85, clientY: 5 })
        expect(menuRows()).toEqual(EVERYDAY_ROWS)
        expect(setUp.spelling.asked).toHaveLength(0)
    })

    it('keeps the highlight on the row you are on when the suggestions come late', async () => {
        const setUp = setup()
        fake = setUp.fake
        fake.focus()
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        const menu = screen.getByRole('menu')
        await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))
        const addToDictionary = screen.getByRole('menuitem', { name: 'Add to Dictionary' })
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
        await waitFor(() => expect(addToDictionary).toHaveFocus())
        expect(addToDictionary).toHaveAttribute('data-highlighted')

        // Three rows come in above it.
        await setUp.spelling.answer(['help', 'hello', 'halo'])
        expect(addToDictionary).toHaveFocus()
        expect([...menu.querySelectorAll('[data-highlighted]')]).toEqual([addToDictionary])

        // The arrow keys carry on from it, and Enter runs the row shown.
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'halo' })).toHaveFocus())
        expect(screen.getByRole('menuitem', { name: 'halo' })).toHaveAttribute('data-highlighted')
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
        await waitFor(() => expect(setUp.spelling.replaced).toEqual(['halo']))
        expect(setUp.spelling.added).toEqual([])
    })

    it('moves you onto the first suggestion if you were on “Looking for suggestions…”', async () => {
        const setUp = setup()
        fake = setUp.fake
        fake.focus()
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        const menu = screen.getByRole('menu')
        await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Looking for suggestions…' })).toHaveFocus())

        await setUp.spelling.answer(['help', 'hello'])
        const help = screen.getByRole('menuitem', { name: 'help' })
        expect(help).toHaveFocus()
        expect([...menu.querySelectorAll('[data-highlighted]')]).toEqual([help])
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
        await waitFor(() => expect(setUp.spelling.replaced).toEqual(['help']))
    })

    it('keeps the row under the mouse highlighted, and gives it focus, when the suggestions come late', async () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        const menu = screen.getByRole('menu')
        await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))
        fireEvent.mouseMove(screen.getByRole('menuitem', { name: 'Add to Dictionary' }), { movementX: 1, movementY: 1 })
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Add to Dictionary' })).toHaveAttribute('data-highlighted'))

        // The second row is now 'hello', and the mouse hasn't moved: that row is the one under it.
        await setUp.spelling.answer(['help', 'hello', 'halo'])
        const hello = screen.getByRole('menuitem', { name: 'hello' })
        expect([...menu.querySelectorAll('[data-highlighted]')]).toEqual([hello])
        expect(hello).toHaveFocus()
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
        await waitFor(() => expect(setUp.spelling.replaced).toEqual(['hello']))
        expect(setUp.spelling.added).toEqual([])
    })

    it('ignores suggestions that come after the menu closed, or for a word right-clicked before', async () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
        await setUp.spelling.answer(['help'])
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()

        // Open again, on the same word: the first answer was for the menu before.
        fireEvent.contextMenu(fake.text, { clientX: 15, clientY: 5 })
        fireEvent.contextMenu(fake.text, { clientX: 35, clientY: 5 })
        await setUp.spelling.answer(['too early'])
        expect(menuRows()[0]).toBe('Looking for suggestions… (off)')
        await setUp.spelling.answer(['hello'])
        expect(menuRows()[0]).toBe('hello')
    })

    it('leaves out what a read-only file can’t do', () => {
        const setUp = setup({ readOnly: true })
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: 85, clientY: 5 })
        expect(menuRows()).toEqual(['CopyCtrl+C', '---', 'Command Palette…F1'])
    })

    it('runs the Edit menu’s commands, Change All Occurrences and the app’s palette', async () => {
        const setUp = setup()
        fake = setUp.fake
        const choose = async (name: string) => {
            fireEvent.contextMenu(fake!.text, { clientX: 85, clientY: 5 })
            fireEvent.click(screen.getByRole('menuitem', { name }))
            await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
        }
        await choose('Cut Ctrl+X')
        await choose('Copy Ctrl+C')
        await choose('Paste Ctrl+V')
        await choose('Change All Occurrences Ctrl+F2')
        await waitFor(() =>
            expect(fake!.triggered).toEqual([
                'editor.action.clipboardCutAction',
                'editor.action.clipboardCopyAction',
                'editor.action.clipboardPasteAction',
                'editor.action.changeAll',
            ])
        )
        await choose('Command Palette… F1')
        expect(openPalette).toHaveBeenCalledTimes(1)
    })

    it('opens under the caret for Shift+F10, and takes the key from Monaco', () => {
        const setUp = setup()
        fake = setUp.fake
        fake.position = { lineNumber: 1, column: 3 }
        expect(fake.press('F10', { shift: true })).toBe(true)
        expect(screen.getByRole('menu')).toBeInTheDocument()
        expect(setUp.spelling.misspeltWordAt).toHaveBeenLastCalledWith({ lineNumber: 1, column: 3 })
        // F10 on its own is left alone.
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        expect(fake.press('F10')).toBe(false)
    })

    it('opens under the caret for the Menu key, which goes to the focused text input', () => {
        const setUp = setup()
        fake = setUp.fake
        fake.focus()
        fake.position = { lineNumber: 1, column: 9 }
        const keyMenu = fireEvent.contextMenu(fake.input, { clientX: 400, clientY: 300 })
        expect(keyMenu).toBe(false)
        expect(screen.getByRole('menu')).toBeInTheDocument()
        expect(fake.position).toEqual({ lineNumber: 1, column: 9 })
        expect(setUp.spelling.misspeltWordAt).toHaveBeenLastCalledWith({ lineNumber: 1, column: 9 })
    })

    it('takes the keyboard for the arrow keys, closes with Esc and gives the editor the keyboard back', async () => {
        const setUp = setup()
        fake = setUp.fake
        fake.focus()
        fireEvent.contextMenu(fake.text, { clientX: 85, clientY: 5 })
        const menu = screen.getByRole('menu')
        await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Cut Ctrl+X' })).toHaveAttribute('data-highlighted'))
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
        expect(fake.input).toHaveFocus()
    })

    it('leaves the find box its own menu, and the keyboard where it is', () => {
        const setUp = setup()
        fake = setUp.fake
        fake.findBox.focus()
        const shown = fireEvent.contextMenu(fake.findBox, { clientX: 300, clientY: 5 })
        expect(shown).toBe(true)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(fake.findBox).toHaveFocus()
    })

    it('opens no menu on the line numbers', () => {
        const setUp = setup()
        fake = setUp.fake
        fireEvent.contextMenu(fake.text, { clientX: -20, clientY: 5 })
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('stops listening when the editor goes', () => {
        const setUp = setup()
        fake = setUp.fake
        setUp.view.unmount()
        expect(fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })).toBe(true)
        expect(fake.press('F10', { shift: true })).toBe(false)
    })
})

describe('listenForEditorContextMenu', () => {
    it('puts the menu at the mouse for a right-click, and just under the caret for the keyboard', () => {
        fake = new FakeEditor()
        const open = vi.fn()
        const listening = listenForEditorContextMenu(fake as unknown as editor.ICodeEditor, open)

        fireEvent.contextMenu(fake.text, { clientX: 25, clientY: 5 })
        expect(open).toHaveBeenLastCalledWith({ point: { x: 25, y: 5 }, position: { lineNumber: 1, column: 3 } })

        // The editor's box starts at (0, 0) here: the caret is at column 9, 80 pixels in, on a line 20 high.
        fake.position = { lineNumber: 1, column: 9 }
        fake.press('F10', { shift: true })
        expect(open).toHaveBeenLastCalledWith({ point: { x: 80, y: 20 }, position: { lineNumber: 1, column: 9 } })
        listening.dispose()
    })
})
