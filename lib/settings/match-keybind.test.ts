import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { matchKeybind } from '@/lib/settings/match-keybind'

function keyEvent(
    key: string,
    modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
    target: EventTarget | null = { tagName: 'BODY' } as unknown as EventTarget
): KeyboardEvent {
    return {
        key,
        code: modifiers.code,
        ctrlKey: modifiers.ctrl ?? false,
        metaKey: modifiers.meta ?? false,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false,
        repeat: false,
        target,
    } as KeyboardEvent
}

describe('matchKeybind', () => {
    const bindings = createDefaultKeybinds(false)

    it('matches F1 for palette.open', () => {
        expect(matchKeybind(keyEvent('F1'), bindings)).toBe('palette.open')
    })

    it('matches Ctrl+S for document.save', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true }), bindings)).toBe('document.save')
    })

    it('matches Ctrl+Shift+S for workspace.saveAll when workspace is open', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true, shift: true }), bindings, { hasWorkspace: true })).toBe('workspace.saveAll')
    })

    it('matches Ctrl+B for view.toggleExplorer when workspace is open', () => {
        expect(matchKeybind(keyEvent('b', { ctrl: true }), bindings, { hasWorkspace: true })).toBe('view.toggleExplorer')
    })

    it('matches Cmd+S on mac defaults', () => {
        const macBindings = createDefaultKeybinds(true)
        expect(matchKeybind(keyEvent('s', { meta: true }), macBindings)).toBe('document.save')
    })

    it('skips save in native text fields', () => {
        const input = { tagName: 'INPUT' } as HTMLElement
        expect(matchKeybind(keyEvent('s', { ctrl: true }, input), bindings)).toBeNull()
    })

    it('allows F1 in native text fields', () => {
        const input = { tagName: 'INPUT' } as HTMLElement
        expect(matchKeybind(keyEvent('F1', {}, input), bindings)).toBe('palette.open')
    })

    it('skips workspace actions without workspace', () => {
        const withShortcut = {
            ...bindings,
            'view.toggleExplorer': [{ key: 'e', ctrl: true }],
        }
        expect(matchKeybind(keyEvent('e', { ctrl: true }), withShortcut, { hasWorkspace: false })).toBeNull()
        expect(matchKeybind(keyEvent('e', { ctrl: true }), withShortcut, { hasWorkspace: true })).toBe('view.toggleExplorer')
    })

    it('ignores repeated key events', () => {
        const event = keyEvent('F1')
        Object.defineProperty(event, 'repeat', { value: true })
        expect(matchKeybind(event, bindings)).toBeNull()
    })

    it('ignores actions with no assigned chords', () => {
        const emptySaveAll = {
            ...bindings,
            'workspace.saveAll': [],
        }
        expect(matchKeybind(keyEvent('s', { ctrl: true, shift: true }), emptySaveAll, { hasWorkspace: true })).toBeNull()
    })

    describe('on other keyboard layouts', () => {
        it('matches Ctrl+S on a Russian layout by the physical key', () => {
            expect(matchKeybind(keyEvent('ы', { ctrl: true, code: 'KeyS' }), bindings)).toBe('document.save')
            expect(matchKeybind(keyEvent('Ы', { ctrl: true, shift: true, code: 'KeyS' }), bindings, { hasWorkspace: true })).toBe('workspace.saveAll')
        })

        it('matches Ctrl+, on a Russian layout, where that key types б', () => {
            expect(matchKeybind(keyEvent('б', { ctrl: true, code: 'Comma' }), bindings)).toBe('settings.open')
        })

        it('matches Ctrl+Shift+1 against a stored 1 and an older stored !', () => {
            const withDigit = { ...bindings, 'view.fitDiagram': [{ key: '1', ctrl: true, shift: true }] }
            const withSymbol = { ...bindings, 'view.fitDiagram': [{ key: '!', ctrl: true, shift: true }] }
            const event = keyEvent('!', { ctrl: true, shift: true, code: 'Digit1' })

            expect(matchKeybind(event, withDigit, { hasWorkspace: true })).toBe('view.fitDiagram')
            expect(matchKeybind(event, withSymbol, { hasWorkspace: true })).toBe('view.fitDiagram')
        })

        it('follows the printed letter on Latin layouts like Dvorak', () => {
            // Dvorak puts "o" where QWERTY has "s"; Ctrl+O must not save.
            expect(matchKeybind(keyEvent('o', { ctrl: true, code: 'KeyS' }), bindings)).toBeNull()
            expect(matchKeybind(keyEvent('s', { ctrl: true, code: 'Semicolon' }), bindings)).toBe('document.save')
        })
    })

    it('does not treat non-field targets as native text fields', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true }, {} as EventTarget), bindings)).toBe('document.save')
    })
})
