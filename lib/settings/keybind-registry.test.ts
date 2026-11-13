import { describe, expect, it } from 'vitest'
import { findKeybindConflicts } from '@/lib/settings/conflicts'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import { getKeybindActionMeta, KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import { matchKeybind } from '@/lib/settings/match-keybind'
import type { KeybindBindings } from '@/lib/settings/types'

describe('keybind registry', () => {
    it('returns metadata for known actions', () => {
        expect(getKeybindActionMeta('document.save')?.label).toBe('Save active document')
    })

    it('returns undefined for unknown actions', () => {
        expect(getKeybindActionMeta('unknown.action' as 'document.save')).toBeUndefined()
    })

    it('lists exactly the actions that have default shortcuts, on every platform', () => {
        const ids = KEYBIND_ACTIONS.map((action) => action.id).sort()
        expect(ids).toEqual(Object.keys(createDefaultKeybinds(false)).sort())
        expect(ids).toEqual(Object.keys(createDefaultKeybinds(true)).sort())
    })

    it('a binding for an unknown action does not stop other shortcuts working', () => {
        const bindings = { 'unknown.action': [{ key: 'w', ctrl: true, alt: true }], ...createDefaultKeybinds(false) } as unknown as KeybindBindings
        const ctrlS = {
            key: 's',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            repeat: false,
            target: null,
        } as unknown as KeyboardEvent

        expect(matchKeybind(ctrlS, bindings)).toBe('document.save')
    })

    it('has tab shortcuts like other tabbed editors, listed under Tabs', () => {
        const keybinds = createDefaultKeybinds(false)
        const shown = (id: Parameters<typeof formatKeybindForAction>[0]) => formatKeybindForAction(id, keybinds, false)
        expect(shown('tabs.close')).toBe('Ctrl+W')
        expect(shown('tabs.next')).toBe('Ctrl+Tab or Ctrl+PageDown')
        expect(shown('tabs.previous')).toBe('Ctrl+Shift+Tab or Ctrl+PageUp')
        expect(shown('tabs.reopenClosed')).toBe('Ctrl+Shift+T')

        const tabActions = KEYBIND_ACTIONS.filter((action) => action.category === 'Tabs')
        expect(tabActions.map((action) => action.label)).toEqual(['Close tab', 'Next tab', 'Previous tab', 'Reopen closed tab'])
        // Tabs only show while a folder is open.
        expect(tabActions.every((action) => action.when === 'workspace')).toBe(true)
    })

    it('gives no two actions the same default shortcut', () => {
        expect(findKeybindConflicts(createDefaultKeybinds(false))).toEqual([])
        expect(findKeybindConflicts(createDefaultKeybinds(true))).toEqual([])
    })

    it('switches tabs with Ctrl+Tab even while typing in the editor', () => {
        // Typing in the editor: the key comes from inside it.
        const target = { tagName: 'TEXTAREA', closest: (selector: string) => (selector === '.monaco-editor' ? {} : null) }
        const press = (init: Partial<KeyboardEvent>) => {
            const event = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, target, ...init } as KeyboardEvent
            return matchKeybind(event, createDefaultKeybinds(false), { hasWorkspace: true })
        }

        expect(press({ key: 'Tab', ctrlKey: true })).toBe('tabs.next')
        expect(press({ key: 'Tab', ctrlKey: true, shiftKey: true })).toBe('tabs.previous')
        expect(press({ key: 'PageDown', ctrlKey: true })).toBe('tabs.next')
        expect(press({ key: 'PageUp', ctrlKey: true })).toBe('tabs.previous')
        expect(press({ key: 'w', ctrlKey: true })).toBe('tabs.close')
        expect(press({ key: 'T', ctrlKey: true, shiftKey: true })).toBe('tabs.reopenClosed')
        // Plain Tab still indents.
        expect(press({ key: 'Tab' })).toBeNull()
    })
})
