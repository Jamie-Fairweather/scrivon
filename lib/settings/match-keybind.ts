import { getKeybindActionMeta, type KeybindActionMeta } from '@/lib/settings/keybind-registry'
import {
    chordsEqual,
    hasCommandModifier,
    isAltCodeKey,
    isComposingKeyEvent,
    isFunctionKey,
    isModifierKey,
    isUnnamedKey,
    physicalKeyFallback,
    typesAltGraphCharacter,
} from '@/lib/settings/chord-utils'
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
    return isInside(target, '.monaco-editor')
}

/**
 * The chords a key press can stand for, best match first: as typed, plus the physical key when the
 * layout gets in the way. A dead key or an unknown key only stands for its physical key, when it has one.
 */
function eventToChords(event: KeyboardEvent): KeybindChord[] {
    const pressed: KeybindChord = {
        key: event.key,
        ctrl: event.ctrlKey || undefined,
        meta: event.metaKey || undefined,
        shift: event.shiftKey || undefined,
        alt: event.altKey || undefined,
    }
    const candidates = isUnnamedKey(pressed.key) ? [] : [pressed]
    // Plus is Shift+= on US and UK keyboards, so Ctrl+Shift+= is Ctrl+Plus too, as in browsers.
    if (pressed.key === '+' && pressed.shift) candidates.push({ ...pressed, shift: undefined })
    const fallback = physicalKeyFallback(event)
    return fallback ? [...candidates, { ...pressed, key: fallback }] : candidates
}

function isInside(target: EventTarget | null, selector: string): boolean {
    if (!target || typeof (target as Element).closest !== 'function') return false
    return (target as Element).closest(selector) !== null
}

function shouldSkipForTarget(meta: KeybindActionMeta, target: EventTarget | null, pressed: KeybindChord, inPalette: boolean): boolean {
    if (meta.leaveInside && isInside(target, meta.leaveInside)) return true
    if (meta.allowInNativeTextField) return false
    // In the editor, real shortcuts (Ctrl/Alt/Cmd or an F-key) work on every platform; a bare key
    // never fires there, so it can't stop that character being typed. The same goes for the palette's
    // search box and the shortcuts that switch what the palette shows.
    if (isInsideCodeEditor(target) || (inPalette && meta.allowInPalette)) return !(hasCommandModifier(pressed) || isFunctionKey(pressed.key))
    return isNativeTextField(target)
}

export type MatchKeybindOptions = {
    hasWorkspace?: boolean
    /** The key was pressed inside the open command palette (usually in its search box). */
    inPalette?: boolean
}

export function matchKeybind(event: KeyboardEvent, bindings: KeybindBindings, options: MatchKeybindOptions = {}): KeybindActionId | null {
    // A modifier or lock key on its own (AltGr, CapsLock…) is never a shortcut.
    if (isModifierKey(event.key)) return null
    // Keys that are part of IME input, characters typed with AltGr, and Alt codes are text, not shortcuts.
    if (isComposingKeyEvent(event) || typesAltGraphCharacter(event) || isAltCodeKey(event)) return null

    const pressed = eventToChords(event)
    if (pressed.length === 0) return null

    const actions = (Object.entries(bindings) as [KeybindActionId, KeybindChord[]][]).filter(([actionId, chords]) => {
        if (chords.length === 0) return false
        // An action this build doesn't know is skipped, so it can't break every other shortcut.
        const meta = getKeybindActionMeta(actionId)
        if (!meta) return false
        if (meta.when === 'workspace' && !options.hasWorkspace) return false
        return !shouldSkipForTarget(meta, event.target, pressed[0], options.inPalette ?? false)
    })

    // The key as typed wins, so a shortcut bound to it isn't taken by one that only matches a looser reading.
    for (const candidate of pressed) {
        const match = actions.find(([, chords]) => chords.some((chord) => chordsEqual(candidate, chord)))
        // Holding the keys down fires only the shortcuts that are meant to repeat.
        if (match) return event.repeat && !getKeybindActionMeta(match[0])?.allowRepeat ? null : match[0]
    }

    return null
}
