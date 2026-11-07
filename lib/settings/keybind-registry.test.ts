import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
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
        const bindings = { 'tabs.close': [{ key: 'w', ctrl: true }], ...createDefaultKeybinds(false) } as unknown as KeybindBindings
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
})
