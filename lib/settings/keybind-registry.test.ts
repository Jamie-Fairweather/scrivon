import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { canShareKeys, getKeybindActionMeta, isEditorAction, KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import { matchKeybind } from '@/lib/settings/match-keybind'
import type { KeybindActionId, KeybindBindings } from '@/lib/settings/types'

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

    it('gives Ctrl+B to Bold in the editor, and Ctrl+Shift+B to Toggle explorer', () => {
        expect(createDefaultKeybinds(false)).toMatchObject({
            'format.bold': [{ key: 'b', ctrl: true }],
            'format.italic': [{ key: 'i', ctrl: true }],
            'format.code': [{ key: 'e', ctrl: true }],
            'format.link': [{ key: 'k', ctrl: true }],
            'view.toggleExplorer': [{ key: 'b', ctrl: true, shift: true }],
        })
        expect(createDefaultKeybinds(true)).toMatchObject({
            'format.bold': [{ key: 'b', meta: true }],
            'view.toggleExplorer': [{ key: 'b', meta: true, shift: true }],
        })
        expect(getKeybindActionMeta('format.bold')).toMatchObject({ label: 'Bold', category: 'Markdown', when: 'editor' })
    })

    it('knows which actions only run in the editor', () => {
        expect(isEditorAction('format.link')).toBe(true)
        expect(isEditorAction('view.toggleEditor')).toBe(false)
        expect(isEditorAction('tabs.close' as KeybindActionId)).toBe(false)
    })

    it('lets an editor action share keys with an app action, but not two of the same kind', () => {
        expect(canShareKeys('format.code', 'view.toggleEditor')).toBe(true)
        expect(canShareKeys('document.save', 'format.bold')).toBe(true)
        expect(canShareKeys('format.code', 'format.bold')).toBe(false)
        expect(canShareKeys('document.save', 'view.toggleEditor')).toBe(false)
        // An action from a newer version is treated as an app action.
        expect(canShareKeys('tabs.close' as KeybindActionId, 'view.toggleEditor')).toBe(false)
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
