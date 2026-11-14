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

    it('has diagram zoom shortcuts on Alt (Cmd+Option on a Mac), leaving Ctrl+=, Ctrl+- and Ctrl+0 for the app', () => {
        const defaults = createDefaultKeybinds(false)
        expect(defaults['view.zoomDiagramIn']).toEqual([{ key: '=', alt: true }])
        expect(defaults['view.zoomDiagramOut']).toEqual([{ key: '-', alt: true }])
        expect(defaults['view.resetDiagramZoom']).toEqual([{ key: '0', alt: true }])
        expect(createDefaultKeybinds(true)['view.zoomDiagramIn']).toEqual([{ key: '=', meta: true, alt: true }])

        expect(getKeybindActionMeta('view.zoomDiagramIn')).toMatchObject({ label: 'Zoom diagram in', category: 'View', when: 'workspace' })
        expect(getKeybindActionMeta('view.zoomDiagramOut')).toMatchObject({ label: 'Zoom diagram out', category: 'View' })
        expect(getKeybindActionMeta('view.resetDiagramZoom')).toMatchObject({ label: 'Reset diagram zoom to 100%', category: 'View' })

        const altEquals = { key: '=', code: 'Equal', ctrlKey: false, altKey: true, metaKey: false, shiftKey: false, repeat: false, target: null }
        expect(matchKeybind(altEquals as unknown as KeyboardEvent, defaults, { hasWorkspace: true })).toBe('view.zoomDiagramIn')
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
