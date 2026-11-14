import { chordKey, chordsEqual, isAllowedChord, isMacPlatform, isReservedKey, isUnnamedKey } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import { KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import type { KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

export type KeybindConflict = {
    chordKey: string
    actionIds: KeybindActionId[]
}

export function findKeybindConflicts(bindings: KeybindBindings): KeybindConflict[] {
    const byKey = new Map<string, KeybindActionId[]>()

    for (const { id } of KEYBIND_ACTIONS) {
        for (const chord of bindings[id] ?? []) {
            const key = chordKey(chord)
            const existing = byKey.get(key) ?? []
            if (!existing.includes(id)) {
                existing.push(id)
            }
            byKey.set(key, existing)
        }
    }

    return [...byKey.entries()].filter(([, actionIds]) => actionIds.length > 1).map(([key, actionIds]) => ({ chordKey: key, actionIds }))
}

/** A short reason a chord can't be used as a shortcut, or null when it can. */
export function describeDisallowedChord(chord: KeybindChord, isMac = isMacPlatform()): string | null {
    if (isUnnamedKey(chord.key)) return "That key can't be used in shortcuts on your keyboard layout"
    if (isAllowedChord(chord)) return null
    if (isReservedKey(chord.key)) return "Enter, Space, Backspace, Delete, arrow keys and Tab (except Ctrl+Tab) can't be used in shortcuts"
    return isMac ? 'Add ⌘, ⌃ or ⌥, or use a function key' : 'Add Ctrl or Alt, or use a function key'
}

/**
 * Editing and clipboard shortcuts that an app shortcut must not take over. App shortcuts run
 * before the editor sees the key, so binding one of these would quietly break it. Written with
 * Ctrl; the same chord with Cmd counts too.
 */
const EDITOR_CHORDS: KeybindChord[] = [
    // Clipboard (Ctrl+Insert copies too), undo and redo, select all
    ...['a', 'c', 'v', 'x', 'z', 'y', 'Insert'].map((key) => ({ key, ctrl: true })),
    { key: 'z', ctrl: true, shift: true },
    // Find, replace, go to line, find next / previous
    ...['f', 'h', 'g'].map((key) => ({ key, ctrl: true })),
    { key: 'F3' },
    { key: 'F3', shift: true },
    // Selections and multi-cursor, change all occurrences
    ...['d', 'l', 'u', 'F2'].map((key) => ({ key, ctrl: true })),
    { key: 'l', ctrl: true, shift: true },
    // Go to (or select to) the start or end of the document
    ...['Home', 'End'].flatMap((key) => [
        { key, ctrl: true },
        { key, ctrl: true, shift: true },
    ]),
    // Comment, indent, outdent, fold, unfold, jump to bracket, delete line, chord prefix
    // (Ctrl+K Ctrl+C…), Tab moves focus
    ...['/', '[', ']', 'k', 'm'].map((key) => ({ key, ctrl: true })),
    // With Shift, a US keyboard reports [ ] \ as { } |, which is what the recorder saves.
    ...['[', ']', '{', '}', '\\', '|', 'k'].map((key) => ({ key, ctrl: true, shift: true })),
]

function usesEditorChord(chord: KeybindChord): boolean {
    if (chord.alt || (chord.ctrl && chord.meta)) return false
    // Ctrl on Windows and Linux, Cmd on macOS.
    const hasCommand = Boolean(chord.ctrl || chord.meta)
    return EDITOR_CHORDS.some(
        (reserved) =>
            reserved.key.toLowerCase() === chord.key.toLowerCase() &&
            Boolean(reserved.ctrl) === hasCommand &&
            Boolean(reserved.shift) === Boolean(chord.shift)
    )
}

/** Why a chord would break an editor or clipboard shortcut, or null when it's free to use. */
export function describeEditorChordClash(chord: KeybindChord, isMac = isMacPlatform()): string | null {
    return usesEditorChord(chord) ? `${formatChord(chord, isMac)} is used by the editor` : null
}

export function wouldChordConflict(bindings: KeybindBindings, actionId: KeybindActionId, chord: KeybindChord): KeybindActionId | null {
    for (const { id } of KEYBIND_ACTIONS) {
        if (id === actionId) continue
        for (const existing of bindings[id] ?? []) {
            if (chordsEqual(existing, chord)) {
                return id
            }
        }
    }
    return null
}
