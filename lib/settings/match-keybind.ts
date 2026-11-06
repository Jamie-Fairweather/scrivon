import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { chordsEqual, physicalKeyFallback } from '@/lib/settings/chord-utils'
import type { KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

export function isNativeTextField(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || !('tagName' in target)) return false
    const tag = String((target as HTMLElement).tagName)
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** The chords a key press can stand for: as typed, plus the physical key when the layout gets in the way. */
function eventToChords(event: KeyboardEvent): KeybindChord[] {
    const pressed: KeybindChord = {
        key: event.key,
        ctrl: event.ctrlKey || undefined,
        meta: event.metaKey || undefined,
        shift: event.shiftKey || undefined,
        alt: event.altKey || undefined,
    }
    const fallback = physicalKeyFallback(event)
    return fallback ? [pressed, { ...pressed, key: fallback }] : [pressed]
}

function shouldSkipForTarget(actionId: KeybindActionId, target: EventTarget | null): boolean {
    const meta = getKeybindActionMeta(actionId)
    if (meta.allowInNativeTextField) return false
    return isNativeTextField(target)
}

export function matchKeybind(event: KeyboardEvent, bindings: KeybindBindings, options: { hasWorkspace?: boolean } = {}): KeybindActionId | null {
    if (event.repeat) return null

    const pressed = eventToChords(event)

    for (const [actionId, chords] of Object.entries(bindings) as [KeybindActionId, KeybindChord[]][]) {
        if (chords.length === 0) continue

        const meta = getKeybindActionMeta(actionId)
        if (meta.when === 'workspace' && !options.hasWorkspace) continue
        if (shouldSkipForTarget(actionId, event.target)) continue

        for (const chord of chords) {
            if (pressed.some((candidate) => chordsEqual(candidate, chord))) {
                return actionId
            }
        }
    }

    return null
}
