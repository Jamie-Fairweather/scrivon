import { getKeybindActionMeta, type KeybindActionMeta } from '@/lib/settings/keybind-registry'
import {
    chordsEqual,
    hasCommandModifier,
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
    if (!target || typeof (target as Element).closest !== 'function') return false
    return (target as Element).closest('.monaco-editor') !== null
}

/** Where Monaco types: a div on WebView2 (Windows), a hidden textarea on WebKit. Not its find box. */
const CODE_EDITOR_TEXT = '.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea'

/** True while typing in the editor's text, where its own actions (Bold, Link…) get the keys first. */
export function isInCodeEditorText(target: EventTarget | null): boolean {
    if (!target || typeof (target as Element).closest !== 'function') return false
    return (target as Element).closest(CODE_EDITOR_TEXT) !== null
}

/**
 * The chords a key press can stand for: as typed, plus the physical key when the layout gets in
 * the way. A dead key or an unknown key only stands for its physical key, when it has one.
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
    const fallback = physicalKeyFallback(event)
    return fallback ? [...candidates, { ...pressed, key: fallback }] : candidates
}

function shouldSkipForTarget(meta: KeybindActionMeta, target: EventTarget | null, pressed: KeybindChord, inPalette: boolean): boolean {
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

/**
 * Every action the key press runs, in the order to try them: an editor action first (it only
 * matches while typing in the editor), then the app's. The caller runs the first that takes it.
 */
export function matchKeybinds(event: KeyboardEvent, bindings: KeybindBindings, options: MatchKeybindOptions = {}): KeybindActionId[] {
    // A modifier or lock key on its own (AltGr, CapsLock…) is never a shortcut.
    if (event.repeat || isModifierKey(event.key)) return []
    // Keys that are part of IME input, or characters typed with AltGr, are text, not shortcuts.
    if (isComposingKeyEvent(event) || typesAltGraphCharacter(event)) return []

    const pressed = eventToChords(event)
    if (pressed.length === 0) return []

    const editorMatches: KeybindActionId[] = []
    const appMatches: KeybindActionId[] = []
    for (const [actionId, chords] of Object.entries(bindings) as [KeybindActionId, KeybindChord[]][]) {
        if (chords.length === 0) continue

        // An action this build doesn't know is skipped, so it can't break every other shortcut.
        const meta = getKeybindActionMeta(actionId)
        if (!meta) continue
        if (meta.when === 'workspace' && !options.hasWorkspace) continue
        if (meta.when === 'editor' && !isInCodeEditorText(event.target)) continue
        if (shouldSkipForTarget(meta, event.target, pressed[0], options.inPalette ?? false)) continue

        if (chords.some((chord) => pressed.some((candidate) => chordsEqual(candidate, chord)))) {
            if (meta.when === 'editor') editorMatches.push(actionId)
            else appMatches.push(actionId)
        }
    }

    return [...editorMatches, ...appMatches]
}

/** The action the key press runs first, or null. */
export function matchKeybind(event: KeyboardEvent, bindings: KeybindBindings, options: MatchKeybindOptions = {}): KeybindActionId | null {
    return matchKeybinds(event, bindings, options)[0] ?? null
}
