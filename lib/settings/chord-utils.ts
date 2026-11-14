import type { KeybindChord } from '@/lib/settings/types'

export function chordKey(chord: KeybindChord): string {
    const parts = [
        chord.ctrl ? 'ctrl' : '',
        chord.meta ? 'meta' : '',
        chord.alt ? 'alt' : '',
        chord.shift ? 'shift' : '',
        chord.key.toLowerCase(),
    ].filter(Boolean)
    return parts.join('+')
}

export function chordsEqual(a: KeybindChord, b: KeybindChord): boolean {
    return (
        a.key.toLowerCase() === b.key.toLowerCase() &&
        Boolean(a.ctrl) === Boolean(b.ctrl) &&
        Boolean(a.meta) === Boolean(b.meta) &&
        Boolean(a.shift) === Boolean(b.shift) &&
        Boolean(a.alt) === Boolean(b.alt)
    )
}

/** Whether two chord lists hold the same chords in the same order. */
export function chordListsEqual(a: readonly KeybindChord[], b: readonly KeybindChord[]): boolean {
    return a.length === b.length && a.every((chord, index) => chordsEqual(chord, b[index]))
}

/** Modifier and lock keys. AltGr, for one, arrives as its own key press before the key it changes. */
const MODIFIER_KEYS = new Set([
    'Shift',
    'Control',
    'Alt',
    'Meta',
    'AltGraph',
    'CapsLock',
    'NumLock',
    'ScrollLock',
    'Fn',
    'FnLock',
    'Hyper',
    'Super',
    'Symbol',
    'SymbolLock',
    'OS',
])

/** Shift, Ctrl, Alt, Cmd, AltGr and the lock keys on their own are not a shortcut. */
export function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key)
}

export function normalizeChord(chord: KeybindChord): KeybindChord {
    return {
        key: chord.key,
        ctrl: chord.ctrl || undefined,
        meta: chord.meta || undefined,
        shift: chord.shift || undefined,
        alt: chord.alt || undefined,
    }
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/i

/** Keys that move focus or edit text. Binding them would break Tab navigation or typing. */
const RESERVED_KEYS = new Set(['tab', 'enter', ' ', 'spacebar', 'escape', 'backspace', 'delete', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

export function isFunctionKey(key: string): boolean {
    return FUNCTION_KEY.test(key)
}

/** True when the chord holds Ctrl, Alt or Cmd/Meta (Shift alone still types). */
export function hasCommandModifier(chord: KeybindChord): boolean {
    return Boolean(chord.ctrl || chord.meta || chord.alt)
}

export function isReservedKey(key: string): boolean {
    return RESERVED_KEYS.has(key.toLowerCase())
}

/** Ctrl+Tab and Ctrl+Shift+Tab, which tabbed apps use to switch tabs. Windows and macOS take Alt+Tab and Cmd+Tab. */
function isCtrlTab(chord: KeybindChord): boolean {
    return chord.key.toLowerCase() === 'tab' && Boolean(chord.ctrl) && !chord.alt && !chord.meta
}

/**
 * What KeyboardEvent.key says when it can't name the key: an input method (IME) is composing,
 * a dead key (´ ^ ` on many layouts) is waiting for the next letter, or the key is unknown.
 * A shortcut on one of these would match every such key.
 */
const UNNAMED_KEYS = new Set(['Process', 'Dead', 'Unidentified'])

export function isUnnamedKey(key: string): boolean {
    return UNNAMED_KEYS.has(key)
}

/** True while an input method (Japanese, Chinese, Korean…) is composing text: the key is part of it. */
export function isComposingKeyEvent(event: { key: string; isComposing?: boolean; keyCode?: number }): boolean {
    return Boolean(event.isComposing) || event.keyCode === 229 || event.key === 'Process'
}

/**
 * True when AltGr makes this key type something, like AltGr+Q typing "@" on a German keyboard or
 * AltGr+E typing "ę" on a Polish one. Windows reports AltGr as Ctrl+Alt, so a Ctrl+Alt shortcut
 * there would stop that character being typed. A key that still gives its own letter or digit
 * (Ctrl+Alt+T on a German keyboard) types nothing, so it can be a shortcut. That includes a
 * non-Latin layout's own letter: Russian has AltGr characters, so Ctrl+Alt+S counts as AltGr
 * there, but it still says "ы" and matches by its physical key.
 */
export function typesAltGraphCharacter(event: {
    key: string
    code?: string
    shiftKey?: boolean
    getModifierState?: (key: string) => boolean
}): boolean {
    if (typeof event.getModifierState !== 'function' || !event.getModifierState('AltGraph')) return false
    if (event.key === 'Dead') return true
    if ([...event.key].length !== 1 || /^[a-z0-9]$/i.test(event.key)) return false
    // Latin letters (ę) and symbols (@, €) are what AltGr types; a non-Latin letter is the key's own.
    const isNonLatinLetter = /^\p{L}$/u.test(event.key) && !LATIN_OR_ASCII.test(event.key)
    return !(isNonLatinLetter && physicalKeyFallback(event) !== null)
}

/**
 * True for Alt with a number-pad digit. On Windows that types a character by its code
 * (Alt+0233 is é), so Alt+0 can't fire on the first digit of one.
 */
export function isAltCodeKey(event: { code?: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): boolean {
    return Boolean(event.altKey && !event.ctrlKey && !event.metaKey) && /^Numpad[0-9]$/.test(event.code ?? '')
}

/**
 * Whether a chord can be an app shortcut: it needs Ctrl, Alt or Cmd unless it is a function key,
 * and it can never use Enter, Space, Escape, Backspace, Delete, the arrow keys, Tab (except
 * Ctrl+Tab), or a key the browser can't name (IME, dead keys).
 */
export function isAllowedChord(chord: KeybindChord): boolean {
    if (isCtrlTab(chord)) return true
    if (isReservedKey(chord.key) || isUnnamedKey(chord.key)) return false
    return hasCommandModifier(chord) || isFunctionKey(chord.key)
}

const CODE_PUNCTUATION: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
}

/** The US-layout character for a physical key (KeyboardEvent.code), or null for other keys. */
export function baseKeyFromCode(code: string | undefined): string | null {
    if (!code) return null
    const letter = /^Key([A-Z])$/.exec(code)
    if (letter) return letter[1].toLowerCase()
    const digit = /^Digit([0-9])$/.exec(code)
    if (digit) return digit[1]
    return CODE_PUNCTUATION[code] ?? null
}

// Plain ASCII and Latin letters (é, ö, ß…) are kept as typed.
const LATIN_OR_ASCII = /^[\x20-\x7eÀ-ɏ]$/

/**
 * The physical key to use when KeyboardEvent.key can't be: non-Latin layouts (Russian, Greek,
 * Hebrew…) report their own letter, so Ctrl+S arrives as "ы", and Shift turns digits into
 * layout-specific symbols, so Ctrl+Shift+1 arrives as "!". Latin layouts (AZERTY, Dvorak…)
 * keep event.key, so shortcuts follow the letter printed on the key.
 */
export function physicalKeyFallback(event: { key: string; code?: string; shiftKey?: boolean }): string | null {
    const base = baseKeyFromCode(event.code)
    if (!base || base === event.key.toLowerCase()) return null
    if ([...event.key].length === 1 && !LATIN_OR_ASCII.test(event.key)) return base
    if (event.shiftKey && /^[0-9]$/.test(base)) return base
    return null
}

export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false

    const hintsPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    if (hintsPlatform) {
        return /mac/i.test(hintsPlatform)
    }

    return /macintosh|mac os x|iphone|ipad/i.test(navigator.userAgent)
}

export function isWindowsPlatform(): boolean {
    if (typeof navigator === 'undefined') return false

    const hintsPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    if (hintsPlatform) {
        return /windows/i.test(hintsPlatform)
    }

    return /windows/i.test(navigator.userAgent)
}
