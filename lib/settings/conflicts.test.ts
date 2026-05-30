import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { findKeybindConflicts, wouldChordConflict } from '@/lib/settings/conflicts'

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
})
