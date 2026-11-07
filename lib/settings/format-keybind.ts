import { isMacPlatform, isWindowsPlatform } from '@/lib/settings/chord-utils'
import type { KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

const KEY_LABELS: Record<string, string> = {
    ',': ',',
    f1: 'F1',
    f2: 'F2',
    f3: 'F3',
    f4: 'F4',
    f5: 'F5',
    f6: 'F6',
    f7: 'F7',
    f8: 'F8',
    f9: 'F9',
    f10: 'F10',
    f11: 'F11',
    f12: 'F12',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    escape: 'Esc',
    enter: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    tab: 'Tab',
    space: 'Space',
    // The space bar's KeyboardEvent.key is a space, which would show as a blank.
    ' ': 'Space',
    spacebar: 'Space',
}

function formatKeyLabel(key: string, isMac: boolean): string {
    // "Ctrl++" reads like a typo. macOS joins keys without "+", so "⌘+" stays as it is.
    if (key === '+' && !isMac) return 'Plus'
    return KEY_LABELS[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** isWindows names the meta key: the Windows key on Windows, Super elsewhere (macOS uses ⌘). */
export function formatChord(chord: KeybindChord, isMac = isMacPlatform(), isWindows = isWindowsPlatform()): string {
    const parts: string[] = []

    if (isMac) {
        if (chord.ctrl) parts.push('⌃')
        if (chord.alt) parts.push('⌥')
        if (chord.shift) parts.push('⇧')
        if (chord.meta) parts.push('⌘')
    } else {
        if (chord.ctrl) parts.push('Ctrl')
        if (chord.alt) parts.push('Alt')
        if (chord.shift) parts.push('Shift')
        if (chord.meta) parts.push(isWindows ? 'Win' : 'Super')
    }

    parts.push(formatKeyLabel(chord.key, isMac))
    return isMac ? parts.join('') : parts.join('+')
}

/**
 * Several chords for one action are alternatives, so they're joined with "or". A space between
 * them would read as a sequence (press one, then the other).
 */
export function formatChords(chords: readonly KeybindChord[], isMac = isMacPlatform()): string {
    return chords.map((chord) => formatChord(chord, isMac)).join(' or ')
}

export function formatKeybindForAction(actionId: KeybindActionId, bindings: KeybindBindings, isMac = isMacPlatform()): string | undefined {
    const chords = bindings[actionId]
    if (!chords || chords.length === 0) return undefined
    return formatChords(chords, isMac)
}
