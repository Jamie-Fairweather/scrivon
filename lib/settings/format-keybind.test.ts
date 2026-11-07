import { describe, expect, it } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { formatChord, formatChords, formatKeybindForAction } from '@/lib/settings/format-keybind'

describe('formatChord', () => {
    it('formats Windows-style chords', () => {
        expect(formatChord({ key: 's', ctrl: true, shift: true }, false)).toBe('Ctrl+Shift+S')
    })

    it('formats macOS-style chords', () => {
        expect(formatChord({ key: 's', meta: true, shift: true }, true)).toBe('⇧⌘S')
        expect(formatChord({ key: 'a', ctrl: true, alt: true, meta: true }, true)).toBe('⌃⌥⌘A')
        expect(formatChord({ key: 'r', ctrl: true }, true)).toBe('⌃R')
    })

    it('names the meta key Win on Windows and Super on Linux', () => {
        expect(formatChord({ key: 'a', meta: true, alt: true }, false, true)).toBe('Alt+Win+A')
        expect(formatChord({ key: 'a', meta: true, alt: true }, false, false)).toBe('Alt+Super+A')
    })

    it('uses special key labels', () => {
        expect(formatChord({ key: 'F1' }, false)).toBe('F1')
        expect(formatChord({ key: 'ArrowUp' }, false)).toBe('↑')
    })

    it('names the space bar and the plus key instead of showing a blank or "++"', () => {
        expect(formatChord({ key: ' ', ctrl: true }, false)).toBe('Ctrl+Space')
        expect(formatChord({ key: ' ', meta: true }, true)).toBe('⌘Space')
        expect(formatChord({ key: '+', ctrl: true }, false)).toBe('Ctrl+Plus')
        expect(formatChord({ key: '+', meta: true }, true)).toBe('⌘+')
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

    it('joins alternative chords with "or", not a space that reads as a sequence', () => {
        const bindings = createDefaultKeybinds(false)
        bindings['document.save'] = [
            { key: 's', ctrl: true },
            { key: 's', ctrl: true, shift: true },
        ]
        expect(formatKeybindForAction('document.save', bindings, false)).toBe('Ctrl+S or Ctrl+Shift+S')
        expect(formatChords(bindings['document.save'], false)).toBe('Ctrl+S or Ctrl+Shift+S')
    })
})
