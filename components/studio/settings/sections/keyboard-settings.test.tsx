import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardSettings } from '@/components/studio/settings/sections/keyboard-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

function row(label: string): HTMLElement {
    return screen.getByText(label).parentElement!.parentElement!
}

/** altGraph: AltGr held, or Ctrl+Alt on a layout that has AltGr (happy-dom would read it from altKey). */
function press(key: string, { altGraph = false, ...init }: KeyboardEventInit & { altGraph?: boolean } = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    const modifierState = event.getModifierState.bind(event)
    Object.defineProperty(event, 'getModifierState', { value: (name: string) => (name === 'AltGraph' ? altGraph : modifierState(name)) })
    fireEvent(document.activeElement ?? document.body, event)
}

function renderKeyboardSettings() {
    return render(
        <SettingsProvider>
            <KeyboardSettings />
        </SettingsProvider>
    )
}

describe('KeyboardSettings recording', () => {
    let store: Map<string, string>

    beforeEach(() => {
        store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('stops recording on a conflict, so a following Tab is not recorded', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        press('b', { ctrlKey: true })

        expect(screen.getByText('Already assigned to Toggle explorer')).toBeInTheDocument()
        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()

        press('Tab')

        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
        expect(document.activeElement).toBe(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
    })

    it('treats Tab as cancel and returns focus to the Edit button', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()
        press('Tab')

        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()
        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
        expect(document.activeElement).toBe(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
    })

    it('refuses a plain letter and keeps recording until a usable chord is pressed', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        press('e')

        expect(screen.getByText('Add Ctrl or Alt, or use a function key')).toBeInTheDocument()
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()

        press('t', { ctrlKey: true, altKey: true })

        expect(screen.queryByText('Add Ctrl or Alt, or use a function key')).not.toBeInTheDocument()
        expect(within(editor).getByText('Ctrl+Alt+T')).toBeInTheDocument()
    })

    it('records the physical key on a non-Latin layout and digits under Shift', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')
        const explorer = row('Toggle explorer')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        press('е', { ctrlKey: true, altKey: true, code: 'KeyT' })
        expect(within(editor).getByText('Ctrl+Alt+T')).toBeInTheDocument()

        fireEvent.click(within(explorer).getByRole('button', { name: /^Edit shortcut/ }))
        press('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' })
        expect(within(explorer).getByText('Ctrl+Shift+1')).toBeInTheDocument()
    })

    it('refuses a character typed with AltGr and keeps recording', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        // Polish: AltGr+E (reported as Ctrl+Alt) types ę.
        press('ę', { ctrlKey: true, altKey: true, code: 'KeyE', altGraph: true })

        expect(within(editor).getByRole('alert')).toHaveTextContent('That combination types a character on your keyboard layout')
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()

        press('t', { ctrlKey: true, altKey: true, code: 'KeyT', altGraph: true })
        expect(within(editor).getByText('Ctrl+Alt+T')).toBeInTheDocument()
    })

    it('waits through AltGr and lock keys for the real key', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        // Windows sends AltGr as its own key press, with Ctrl and Alt held.
        press('AltGraph', { ctrlKey: true, altKey: true, code: 'AltRight', altGraph: true })
        for (const key of ['CapsLock', 'NumLock', 'ScrollLock', 'OS']) press(key)

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()

        press('t', { ctrlKey: true, altKey: true, code: 'KeyT' })
        expect(within(editor).getByText('Ctrl+Alt+T')).toBeInTheDocument()
    })

    it('ignores IME keystrokes and refuses a dead key while recording', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        press('Process', { ctrlKey: true, keyCode: 229 })
        press('a', { ctrlKey: true, isComposing: true })

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()

        press('Dead', { ctrlKey: true, code: 'Quote' })
        expect(within(editor).getByRole('alert')).toHaveTextContent("That key can't be used in shortcuts on your keyboard layout")
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()

        press('Escape')
        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
    })

    it('warns on both rows when two shortcuts share a chord', () => {
        const chord = { key: 'r', ctrl: true, alt: true }
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ keybinds: { 'view.toggleEditor': [chord], 'view.fitDiagram': [chord] } }))
        renderKeyboardSettings()

        expect(within(row('Toggle editor')).getByText('Same shortcut as Fit diagram to screen. Only one of them will run.')).toBeInTheDocument()
        expect(within(row('Fit diagram to screen')).getByText('Same shortcut as Toggle editor. Only one of them will run.')).toBeInTheDocument()
        expect(within(row('Toggle explorer')).queryByText(/Same shortcut/)).not.toBeInTheDocument()
    })

    it('shows why Reset did nothing when the default is taken', () => {
        renderKeyboardSettings()

        fireEvent.click(within(row('Toggle editor')).getByRole('button', { name: /^Clear shortcut/ }))
        fireEvent.click(within(row('Toggle explorer')).getByRole('button', { name: /^Edit shortcut/ }))
        press('e', { ctrlKey: true })
        fireEvent.click(within(row('Toggle editor')).getByRole('button', { name: /^Reset .* to default$/ }))

        expect(screen.getByText('Ctrl+E is already assigned to Toggle explorer')).toBeInTheDocument()
        expect(within(row('Toggle editor')).getByText('Not assigned')).toBeInTheDocument()
    })

    it('names each row button after its action', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        expect(within(editor).getByRole('button', { name: 'Edit shortcut for Toggle editor' })).toBeInTheDocument()
        expect(within(editor).getByRole('button', { name: 'Clear shortcut for Toggle editor' })).toBeInTheDocument()
        expect(within(editor).getByRole('button', { name: 'Reset Toggle editor to default' })).toBeInTheDocument()

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        expect(within(editor).getByRole('button', { name: 'Press shortcut… for Toggle editor. Esc cancels.' })).toBeInTheDocument()
    })

    it('announces a refused shortcut in its own row and clears it when another row is edited', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        press('b', { ctrlKey: true })

        expect(within(editor).getByRole('alert')).toHaveTextContent('Already assigned to Toggle explorer')

        fireEvent.click(within(row('Fit diagram to screen')).getByRole('button', { name: /^Edit shortcut/ }))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('stops recording from the Cancel button or a click on the recorder', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')
        const edit = () => within(editor).getByRole('button', { name: /^Edit shortcut/ })

        fireEvent.click(edit())
        fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()
        expect(document.activeElement).toBe(edit())

        fireEvent.click(edit())
        fireEvent.click(within(editor).getByRole('button', { name: /^Press shortcut/ }))
        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()
        expect(document.activeElement).toBe(edit())
    })

    it('stops recording when focus moves away, and leaves focus where it went', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')
        const resetAll = screen.getByRole('button', { name: 'Reset all' })

        fireEvent.click(within(editor).getByRole('button', { name: /^Edit shortcut/ }))
        act(() => resetAll.focus())

        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()
        expect(document.activeElement).toBe(resetAll)

        press('k', { ctrlKey: true, altKey: true })
        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
    })
})
