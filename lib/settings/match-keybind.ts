import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { chordsEqual, hasCommandModifier, isFunctionKey, physicalKeyFallback } from '@/lib/settings/chord-utils'
import type { KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

export function isNativeTextField(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || !('tagName' in target)) return false
    const tag = String((target as HTMLElement).tagName)
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Monaco types into a hidden textarea on WebKit (macOS, Linux) and a div on WebView2 (Windows),
 * and its find box is a textarea too, so look for the editor itself rather than the element type.
 */
export function isInsideCodeEditor(target: EventTarget | null): boolean {
    if (!target || typeof (target as Element).closest !== 'function') return false
    return (target as Element).closest('.monaco-editor') !== null
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

function shouldSkipForTarget(actionId: KeybindActionId, target: EventTarget | null, pressed: KeybindChord): boolean {
    const meta = getKeybindActionMeta(actionId)
    if (meta.allowInNativeTextField) return false
    // In the editor, real shortcuts (Ctrl/Alt/Cmd or an F-key) work on every platform; a bare key
    // never fires there, so it can't stop that character being typed.
    if (isInsideCodeEditor(target)) return !(hasCommandModifier(pressed) || isFunctionKey(pressed.key))
    return isNativeTextField(target)
}

export function matchKeybind(event: KeyboardEvent, bindings: KeybindBindings, options: { hasWorkspace?: boolean } = {}): KeybindActionId | null {
    if (event.repeat) return null

    const pressed = eventToChords(event)

    for (const [actionId, chords] of Object.entries(bindings) as [KeybindActionId, KeybindChord[]][]) {
        if (chords.length === 0) continue

        const meta = getKeybindActionMeta(actionId)
        if (meta.when === 'workspace' && !options.hasWorkspace) continue
        if (shouldSkipForTarget(actionId, event.target, pressed[0])) continue

        for (const chord of chords) {
            if (pressed.some((candidate) => chordsEqual(candidate, chord))) {
                return actionId
            }
        }
    }

    return null
}
