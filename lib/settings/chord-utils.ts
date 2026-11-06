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

export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false

    const hintsPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    if (hintsPlatform) {
        return /mac/i.test(hintsPlatform)
    }

    return /macintosh|mac os x|iphone|ipad/i.test(navigator.userAgent)
}
