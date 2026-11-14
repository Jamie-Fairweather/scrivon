import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import {
    describeDisallowedChord,
    describeEditorChordClash,
    editorActionsSharingKeys,
    findKeybindConflicts,
    wouldChordConflict,
} from '@/lib/settings/conflicts'
import type { KeybindActionId, KeybindChord } from '@/lib/settings/types'

describe('findKeybindConflicts', () => {
    it('returns empty when defaults have no duplicates', () => {
        expect(findKeybindConflicts(createDefaultKeybinds(false))).toEqual([])
    })

    it('detects duplicate chords across actions', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['settings.open'] = [{ key: 's', ctrl: true }]

        const conflicts = findKeybindConflicts(bindings)
        expect(conflicts).toHaveLength(1)
        expect(conflicts[0]?.actionIds).toEqual(expect.arrayContaining(['document.save', 'settings.open']))
    })

    it('deduplicates repeated chords on the same action', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['document.save'] = [
            { key: 's', ctrl: true },
            { key: 's', ctrl: true },
        ]

        expect(findKeybindConflicts(bindings)).toEqual([])
    })

    it('ignores actions without assigned chords', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['workspace.saveAll'] = undefined as unknown as []

        expect(findKeybindConflicts(bindings)).toEqual([])
    })

    it('lets a Markdown action share keys with an app action, but not with another Markdown action', () => {
        const bindings = createDefaultKeybinds(false)
        // By default Ctrl+E is Inline code while typing in the editor, and Toggle editor everywhere else.
        expect(bindings['format.code']).toEqual(bindings['view.toggleEditor'])
        bindings['format.bold'] = [{ key: 's', ctrl: true }]
        expect(findKeybindConflicts(bindings)).toEqual([])

        bindings['format.italic'] = [{ key: 's', ctrl: true }]
        bindings['settings.open'] = [{ key: 's', ctrl: true }]
        expect(findKeybindConflicts(bindings)).toEqual([
            { chordKey: 'ctrl+s', actionIds: ['document.save', 'settings.open'] },
            { chordKey: 'ctrl+s', actionIds: ['format.bold', 'format.italic'] },
        ])
    })
})

describe('editorActionsSharingKeys', () => {
    it("names the Markdown actions that take an app action's keys while typing in the editor", () => {
        const bindings = createDefaultKeybinds(false)

        expect(editorActionsSharingKeys(bindings, 'view.toggleEditor')).toEqual([{ chord: { key: 'e', ctrl: true }, actionId: 'format.code' }])
        expect(editorActionsSharingKeys(bindings, 'document.save')).toEqual([])
        expect(editorActionsSharingKeys(bindings, 'format.code')).toEqual([])
    })
})

describe('wouldChordConflict', () => {
    it('returns conflicting action id', () => {
        const bindings = createDefaultKeybinds(false)
        const conflict = wouldChordConflict(bindings, 'settings.open', { key: 's', ctrl: true })
        expect(conflict).toBe('document.save')
    })

    it('returns null for same action chord replacement', () => {
        const bindings = createDefaultKeybinds(false)
        const conflict = wouldChordConflict(bindings, 'document.save', { key: 's', ctrl: true })
        expect(conflict).toBeNull()
    })

    it('ignores actions without assigned chords', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['workspace.saveAll'] = undefined as unknown as []
        expect(wouldChordConflict(bindings, 'document.save', { key: 'z', ctrl: true })).toBeNull()
    })

    it('only checks actions that run in the same place', () => {
        const bindings = createDefaultKeybinds(false)
        expect(wouldChordConflict(bindings, 'view.fitDiagram', { key: 'b', ctrl: true })).toBeNull()
        expect(wouldChordConflict(bindings, 'format.italic', { key: 's', ctrl: true })).toBeNull()
        expect(wouldChordConflict(bindings, 'format.italic', { key: 'b', ctrl: true })).toBe('format.bold')
    })
})

describe('describeDisallowedChord', () => {
    it('allows normal shortcuts', () => {
        expect(describeDisallowedChord({ key: 'b', ctrl: true }, false)).toBeNull()
        expect(describeDisallowedChord({ key: 'F2' }, false)).toBeNull()
    })

    it('asks for a modifier on plain keys', () => {
        expect(describeDisallowedChord({ key: 'e' }, false)).toBe('Add Ctrl or Alt, or use a function key')
        expect(describeDisallowedChord({ key: 'e', shift: true }, true)).toBe('Add ⌘, ⌃ or ⌥, or use a function key')
    })

    it('explains that a dead key or IME key cannot be a shortcut', () => {
        expect(describeDisallowedChord({ key: 'Dead', ctrl: true }, false)).toBe("That key can't be used in shortcuts on your keyboard layout")
        expect(describeDisallowedChord({ key: 'Process', ctrl: true }, false)).toBe("That key can't be used in shortcuts on your keyboard layout")
    })

    it('explains that navigation and editing keys are off limits', () => {
        expect(describeDisallowedChord({ key: 'Enter', ctrl: true }, false)).toMatch(/can't be used in shortcuts/)
        expect(describeDisallowedChord({ key: 'Tab', alt: true }, false)).toMatch(/can't be used in shortcuts/)
        expect(describeDisallowedChord({ key: 'Tab', ctrl: true }, false)).toBeNull()
    })
})

describe('describeEditorChordClash', () => {
    it('flags editor and clipboard shortcuts with Ctrl or Cmd', () => {
        expect(describeEditorChordClash({ key: 'd', ctrl: true }, false)).toBe('Ctrl+D is used by the editor')
        expect(describeEditorChordClash({ key: 'C', ctrl: true }, false)).toBe('Ctrl+C is used by the editor')
        expect(describeEditorChordClash({ key: '/', meta: true }, true)).toBe('⌘/ is used by the editor')
        expect(describeEditorChordClash({ key: 'k', ctrl: true, shift: true }, false)).toBe('Ctrl+Shift+K is used by the editor')
        expect(describeEditorChordClash({ key: 'F3' }, false)).toBe('F3 is used by the editor')
    })

    it('flags document start and end, Ctrl+Insert, Tab focus mode, change all and jump to bracket', () => {
        const editorChords = [
            { key: 'Home', ctrl: true },
            { key: 'End', ctrl: true },
            { key: 'Home', ctrl: true, shift: true },
            { key: 'End', ctrl: true, shift: true },
            { key: 'Insert', ctrl: true },
            { key: 'm', ctrl: true },
            { key: 'F2', ctrl: true },
            { key: '\\', ctrl: true, shift: true },
            // What a US keyboard reports for Ctrl+Shift+\ and Ctrl+Shift+[
            { key: '|', ctrl: true, shift: true },
            { key: '{', ctrl: true, shift: true },
        ]
        for (const chord of editorChords) {
            expect(describeEditorChordClash(chord, false)).not.toBeNull()
        }
        expect(describeEditorChordClash({ key: 'Home', meta: true }, true)).not.toBeNull()
        expect(describeEditorChordClash({ key: 'F2' }, false)).toBeNull()
        expect(describeEditorChordClash({ key: 'm', ctrl: true, shift: true }, false)).toBeNull()
    })

    it('leaves other chords free', () => {
        expect(describeEditorChordClash({ key: 'd', ctrl: true, alt: true }, false)).toBeNull()
        expect(describeEditorChordClash({ key: 'd', ctrl: true, shift: true }, false)).toBeNull()
        expect(describeEditorChordClash({ key: 'F3', ctrl: true, meta: true }, false)).toBeNull()
        expect(describeEditorChordClash({ key: 'b', ctrl: true }, false)).toBeNull()
    })

    it('never flags a default shortcut', () => {
        for (const isMac of [false, true]) {
            const defaults = createDefaultKeybinds(isMac)
            for (const [actionId, chords] of Object.entries(defaults) as [KeybindActionId, KeybindChord[]][]) {
                for (const chord of chords) {
                    expect(describeEditorChordClash(chord, isMac, actionId)).toBeNull()
                }
            }
        }
    })

    it('lets Markdown actions take Ctrl+K, which only starts two-key editor shortcuts', () => {
        expect(describeEditorChordClash({ key: 'k', ctrl: true }, false, 'format.bold')).toBeNull()
        expect(describeEditorChordClash({ key: 'k', meta: true }, true, 'format.link')).toBeNull()
        expect(describeEditorChordClash({ key: 'k', ctrl: true }, false, 'view.toggleEditor')).toBe('Ctrl+K is used by the editor')
        expect(describeEditorChordClash({ key: 'c', ctrl: true }, false, 'format.bold')).toBe('Ctrl+C is used by the editor')
    })
})
