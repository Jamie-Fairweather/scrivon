import { describe, expect, it } from 'vitest'
import {
    formatWorkspaceReplaceKey,
    isWorkspaceReplaceChord,
    workspaceReplaceAriaKeys,
    workspaceReplaceKeyForEvent,
} from '@/lib/settings/workspace-replace-keys'

type Press = Partial<Parameters<typeof workspaceReplaceKeyForEvent>[0]> & { key: string }

function press(event: Press) {
    return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...event }
}

describe('workspaceReplaceKeyForEvent', () => {
    it('reads Ctrl+Shift+1 by the physical key, whatever Shift+1 types on the layout', () => {
        expect(workspaceReplaceKeyForEvent(press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false)).toBe('replaceOne')
        // French: Shift+& types 1.
        expect(workspaceReplaceKeyForEvent(press({ key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true }), false)).toBe('replaceOne')
    })

    it('reads Ctrl+Alt+Enter, which AltGr+Enter also is on Windows', () => {
        expect(workspaceReplaceKeyForEvent(press({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true }), false)).toBe('replaceAll')
    })

    it('uses Cmd on macOS', () => {
        expect(workspaceReplaceKeyForEvent(press({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), true)).toBe('replaceOne')
        expect(workspaceReplaceKeyForEvent(press({ key: 'Enter', metaKey: true, altKey: true }), true)).toBe('replaceAll')
        expect(workspaceReplaceKeyForEvent(press({ key: 'Enter', ctrlKey: true, altKey: true }), true)).toBeNull()
    })

    it('ignores other keys and modifiers, and IME input', () => {
        expect(workspaceReplaceKeyForEvent(press({ key: '1', code: 'Digit1', ctrlKey: true }), false)).toBeNull()
        expect(workspaceReplaceKeyForEvent(press({ key: 'Enter', ctrlKey: true }), false)).toBeNull()
        expect(workspaceReplaceKeyForEvent(press({ key: 'Enter', altKey: true }), false)).toBeNull()
        expect(workspaceReplaceKeyForEvent(press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true, altKey: true }), false)).toBeNull()
        expect(workspaceReplaceKeyForEvent(press({ key: 'Process', code: 'Digit1', ctrlKey: true, shiftKey: true }), false)).toBeNull()
    })
})

describe('workspace replace key names', () => {
    it('writes the keys as the app writes shortcuts, and for aria-keyshortcuts', () => {
        expect(formatWorkspaceReplaceKey('replaceOne', false)).toBe('Ctrl+Shift+1')
        expect(formatWorkspaceReplaceKey('replaceAll', false)).toBe('Ctrl+Alt+Enter')
        expect(formatWorkspaceReplaceKey('replaceOne', true)).toBe('⇧⌘1')
        expect(workspaceReplaceAriaKeys('replaceOne', false)).toBe('Control+Shift+1')
        expect(workspaceReplaceAriaKeys('replaceAll', true)).toBe('Meta+Alt+Enter')
    })

    it('knows a saved shortcut that is one of them', () => {
        expect(isWorkspaceReplaceChord({ key: '!', ctrl: true, shift: true }, false)).toBe(true)
        expect(isWorkspaceReplaceChord({ key: '1', ctrl: true, shift: true }, false)).toBe(true)
        expect(isWorkspaceReplaceChord({ key: 'Enter', ctrl: true, alt: true }, false)).toBe(true)
        expect(isWorkspaceReplaceChord({ key: '1', ctrl: true }, false)).toBe(false)
    })
})
