import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardSettings } from '@/components/studio/settings/sections/keyboard-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

function row(label: string): HTMLElement {
    return screen.getByText(label).parentElement!.parentElement!
}

function press(key: string, init: KeyboardEventInit = {}) {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
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

        fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
        press('b', { ctrlKey: true })

        expect(screen.getByText('Already assigned to Toggle explorer')).toBeInTheDocument()
        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()

        press('Tab')

        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
        expect(document.activeElement).toBe(within(editor).getByRole('button', { name: 'Edit' }))
    })

    it('treats Tab as cancel and returns focus to the Edit button', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
        expect(screen.getByText('Press shortcut…')).toBeInTheDocument()
        press('Tab')

        expect(screen.queryByText('Press shortcut…')).not.toBeInTheDocument()
        expect(within(editor).getByText('Ctrl+E')).toBeInTheDocument()
        expect(document.activeElement).toBe(within(editor).getByRole('button', { name: 'Edit' }))
    })

    it('refuses a plain letter and keeps recording until a usable chord is pressed', () => {
        renderKeyboardSettings()
        const editor = row('Toggle editor')

        fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
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

        fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
        press('е', { ctrlKey: true, altKey: true, code: 'KeyT' })
        expect(within(editor).getByText('Ctrl+Alt+T')).toBeInTheDocument()

        fireEvent.click(within(explorer).getByRole('button', { name: 'Edit' }))
        press('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' })
        expect(within(explorer).getByText('Ctrl+Shift+1')).toBeInTheDocument()
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

        fireEvent.click(within(row('Toggle editor')).getByRole('button', { name: 'Clear' }))
        fireEvent.click(within(row('Toggle explorer')).getByRole('button', { name: 'Edit' }))
        press('e', { ctrlKey: true })
        fireEvent.click(within(row('Toggle editor')).getByRole('button', { name: 'Reset' }))

        expect(screen.getByText('Ctrl+E is already assigned to Toggle explorer')).toBeInTheDocument()
        expect(within(row('Toggle editor')).getByText('Not assigned')).toBeInTheDocument()
    })
})
