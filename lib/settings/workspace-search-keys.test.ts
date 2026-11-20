import { describe, expect, it } from 'vitest'
import {
    formatWorkspaceSearchOptionKey,
    isWorkspaceSearchOptionChord,
    workspaceSearchOptionAriaKeys,
    workspaceSearchOptionForKey,
} from '@/lib/settings/workspace-search-keys'

type Press = Partial<Parameters<typeof workspaceSearchOptionForKey>[0]> & { key: string }

function press({ altGraph = false, ...event }: Press & { altGraph?: boolean }) {
    return {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        getModifierState: (key: string) => key === 'AltGraph' && altGraph,
        ...event,
    }
}

describe('workspaceSearchOptionForKey', () => {
    it('reads Alt+C, Alt+W and Alt+R', () => {
        expect(workspaceSearchOptionForKey(press({ key: 'c', code: 'KeyC', altKey: true }), false)).toBe('matchCase')
        expect(workspaceSearchOptionForKey(press({ key: 'w', code: 'KeyW', altKey: true }), false)).toBe('wholeWord')
        expect(workspaceSearchOptionForKey(press({ key: 'R', code: 'KeyR', altKey: true }), false)).toBe('useRegex')
    })

    it('ignores other keys and other modifiers', () => {
        expect(workspaceSearchOptionForKey(press({ key: 'c', code: 'KeyC' }), false)).toBeNull()
        expect(workspaceSearchOptionForKey(press({ key: 'x', code: 'KeyX', altKey: true }), false)).toBeNull()
        expect(workspaceSearchOptionForKey(press({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true }), false)).toBeNull()
        expect(workspaceSearchOptionForKey(press({ key: 'c', code: 'KeyC', altKey: true, metaKey: true }), false)).toBeNull()
    })

    it('works on a Russian layout, by the physical key', () => {
        expect(workspaceSearchOptionForKey(press({ key: 'с', code: 'KeyC', altKey: true }), false)).toBe('matchCase')
        expect(workspaceSearchOptionForKey(press({ key: 'к', code: 'KeyR', altKey: true }), false)).toBe('useRegex')
    })

    it("leaves Polish AltGr+C to type 'ć'", () => {
        // Windows reports AltGr as Ctrl+Alt.
        expect(workspaceSearchOptionForKey(press({ key: 'ć', code: 'KeyC', altKey: true, ctrlKey: true, altGraph: true }), false)).toBeNull()
        // Elsewhere AltGr may come without Ctrl.
        expect(workspaceSearchOptionForKey(press({ key: 'ć', code: 'KeyC', altKey: true, altGraph: true }), false)).toBeNull()
    })

    it('does nothing during IME composition', () => {
        expect(workspaceSearchOptionForKey(press({ key: 'Process', code: 'KeyC', altKey: true }), false)).toBeNull()
        expect(workspaceSearchOptionForKey(press({ key: 'c', code: 'KeyC', altKey: true, isComposing: true }), false)).toBeNull()
    })

    it('needs Cmd+Option on macOS, where Option+C reports ç', () => {
        expect(workspaceSearchOptionForKey(press({ key: 'ç', code: 'KeyC', altKey: true, metaKey: true }), true)).toBe('matchCase')
        expect(workspaceSearchOptionForKey(press({ key: '®', code: 'KeyR', altKey: true, metaKey: true }), true)).toBe('useRegex')
        // Some browsers report Option as AltGraph; with Cmd held nothing is typed, so it still counts.
        expect(workspaceSearchOptionForKey(press({ key: '∑', code: 'KeyW', altKey: true, metaKey: true, altGraph: true }), true)).toBe('wholeWord')
        expect(workspaceSearchOptionForKey(press({ key: 'ç', code: 'KeyC', altKey: true }), true)).toBeNull()
    })
})

describe('the key as shown', () => {
    it('writes Alt+C on Windows and ⌥⌘C on macOS', () => {
        expect(formatWorkspaceSearchOptionKey('matchCase', false)).toBe('Alt+C')
        expect(formatWorkspaceSearchOptionKey('useRegex', true)).toBe('⌥⌘R')
        expect(workspaceSearchOptionAriaKeys('wholeWord', false)).toBe('Alt+W')
        expect(workspaceSearchOptionAriaKeys('wholeWord', true)).toBe('Meta+Alt+W')
    })
})

describe('isWorkspaceSearchOptionChord', () => {
    it('knows the three chords, as saved on each platform', () => {
        expect(isWorkspaceSearchOptionChord({ key: 'R', alt: true }, false)).toBe(true)
        expect(isWorkspaceSearchOptionChord({ key: 'r', alt: true, shift: true }, false)).toBe(false)
        expect(isWorkspaceSearchOptionChord({ key: 'r', meta: true, alt: true }, true)).toBe(true)
        expect(isWorkspaceSearchOptionChord({ key: '®', meta: true, alt: true }, true)).toBe(true)
        expect(isWorkspaceSearchOptionChord({ key: 'r', alt: true }, true)).toBe(false)
    })
})
