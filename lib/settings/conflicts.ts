import { chordKey, chordsEqual } from '@/lib/settings/chord-utils'
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
