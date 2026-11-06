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

/**
 * Whether a chord can be an app shortcut: it needs Ctrl, Alt or Cmd unless it is a function key,
 * and it can never use Tab, Enter, Space, Escape, Backspace, Delete or the arrow keys.
 */
export function isAllowedChord(chord: KeybindChord): boolean {
    if (isReservedKey(chord.key)) return false
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
