import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { formatChord, formatChordKey, formatKeybindForAction } from '@/lib/settings/format-keybind'

describe('formatChord', () => {
    it('formats Windows-style chords', () => {
        expect(formatChord({ key: 's', ctrl: true, shift: true }, false)).toBe('Ctrl+Shift+S')
    })

    it('formats macOS-style chords', () => {
        expect(formatChord({ key: 's', meta: true, shift: true }, true)).toBe('⇧⌘S')
        expect(formatChord({ key: 'a', ctrl: true, alt: true, meta: true }, true)).toBe('⌃⌥⌘A')
        expect(formatChord({ key: 'r', ctrl: true }, true)).toBe('⌃R')
    })

    it('formats Windows-style chords with meta and alt', () => {
        expect(formatChord({ key: 'a', meta: true, alt: true }, false)).toBe('Alt+Meta+A')
    })

    it('uses special key labels', () => {
        expect(formatChord({ key: 'F1' }, false)).toBe('F1')
        expect(formatChord({ key: 'ArrowUp' }, false)).toBe('↑')
    })
})

describe('formatKeybindForAction', () => {
    it('returns undefined when no chords are assigned', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['workspace.saveAll'] = []
        expect(formatKeybindForAction('workspace.saveAll', bindings)).toBeUndefined()

        bindings['settings.open'] = undefined as unknown as []
        expect(formatKeybindForAction('settings.open', bindings)).toBeUndefined()
    })

    it('joins multiple chords for an action', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['document.save'] = [
            { key: 's', ctrl: true },
            { key: 's', meta: true },
        ]
        expect(formatKeybindForAction('document.save', bindings, false)).toBe('Ctrl+S Meta+S')
    })
})

describe('formatChordKey', () => {
    it('delegates to chordKey', () => {
        expect(formatChordKey({ key: 'b', ctrl: true })).toBe('ctrl+b')
    })
})
