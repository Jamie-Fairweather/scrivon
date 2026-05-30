import { chordKey } from '@/lib/settings/chord-utils'
import { isMacPlatform } from '@/lib/settings/chord-utils'
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
}

function formatKeyLabel(key: string): string {
    const normalized = key.length === 1 ? key.toUpperCase() : key
    return KEY_LABELS[key.toLowerCase()] ?? normalized
}

export function formatChord(chord: KeybindChord, isMac = isMacPlatform()): string {
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
        if (chord.meta) parts.push('Meta')
    }

    parts.push(formatKeyLabel(chord.key))
    return isMac ? parts.join('') : parts.join('+')
}

export function formatKeybindForAction(actionId: KeybindActionId, bindings: KeybindBindings, isMac = isMacPlatform()): string | undefined {
    const chords = bindings[actionId]
    if (!chords || chords.length === 0) return undefined
    return chords.map((chord) => formatChord(chord, isMac)).join(' ')
}

export function formatChordKey(chord: KeybindChord): string {
    return chordKey(chord)
}
