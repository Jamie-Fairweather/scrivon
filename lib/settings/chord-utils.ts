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

export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false

    const hintsPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    if (hintsPlatform) {
        return /mac/i.test(hintsPlatform)
    }

    return /macintosh|mac os x|iphone|ipad/i.test(navigator.userAgent)
}
