import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { matchKeybind } from '@/lib/settings/match-keybind'

function keyEvent(
    key: string,
    modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
    target: EventTarget | null = { tagName: 'BODY' } as EventTarget
): KeyboardEvent {
    return {
        key,
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

    it('does not treat non-field targets as native text fields', () => {
        expect(matchKeybind(keyEvent('s', { ctrl: true }, {} as EventTarget), bindings)).toBe('document.save')
    })
})
