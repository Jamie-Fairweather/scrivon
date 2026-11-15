import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    baseKeyFromCode,
    chordKey,
    chordsEqual,
    isAllowedChord,
    isAltCodeKey,
    isComposingKeyEvent,
    isMacPlatform,
    isWindowsPlatform,
    normalizeChord,
    physicalKeyFallback,
    typesAltGraphCharacter,
} from '@/lib/settings/chord-utils'

describe('chordKey', () => {
    it('builds a normalized modifier key', () => {
        expect(chordKey({ key: 's', ctrl: true, shift: true })).toBe('ctrl+shift+s')
        expect(chordKey({ key: 'a', meta: true, alt: true })).toBe('meta+alt+a')
    })
})

describe('chordsEqual', () => {
    it('compares keys case-insensitively and normalizes modifiers', () => {
        expect(chordsEqual({ key: 'S', ctrl: true }, { key: 's', ctrl: true })).toBe(true)
        expect(chordsEqual({ key: 's', ctrl: true }, { key: 's', meta: true })).toBe(false)
    })
})

describe('normalizeChord', () => {
    it('drops falsey modifier flags', () => {
        expect(normalizeChord({ key: 'a', ctrl: false, shift: true, alt: true, meta: true })).toEqual({
            key: 'a',
            shift: true,
            alt: true,
            meta: true,
        })
        expect(normalizeChord({ key: 'x', ctrl: true })).toEqual({ key: 'x', ctrl: true })
    })
})

describe('isAllowedChord', () => {
    it('accepts chords with Ctrl, Alt or Cmd, and bare function keys', () => {
        expect(isAllowedChord({ key: 's', ctrl: true })).toBe(true)
        expect(isAllowedChord({ key: 'k', alt: true, shift: true })).toBe(true)
        expect(isAllowedChord({ key: ',', meta: true })).toBe(true)
        expect(isAllowedChord({ key: 'F1' })).toBe(true)
        expect(isAllowedChord({ key: 'F12', shift: true })).toBe(true)
    })

    it('rejects keys that would stop you typing', () => {
        expect(isAllowedChord({ key: 'e' })).toBe(false)
        expect(isAllowedChord({ key: 'E', shift: true })).toBe(false)
        expect(isAllowedChord({ key: '/' })).toBe(false)
    })

    it('rejects Enter, Space, Escape, Backspace, Delete and arrows even with modifiers', () => {
        for (const key of ['Enter', ' ', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
            expect(isAllowedChord({ key })).toBe(false)
            expect(isAllowedChord({ key, ctrl: true })).toBe(false)
        }
    })

    it('accepts Tab only with Ctrl, as tabbed apps use it to switch tabs', () => {
        expect(isAllowedChord({ key: 'Tab', ctrl: true })).toBe(true)
        expect(isAllowedChord({ key: 'Tab', ctrl: true, shift: true })).toBe(true)
        // Plain Tab moves focus, and Windows or macOS take Alt+Tab and Cmd+Tab.
        expect(isAllowedChord({ key: 'Tab' })).toBe(false)
        expect(isAllowedChord({ key: 'Tab', shift: true })).toBe(false)
        expect(isAllowedChord({ key: 'Tab', alt: true })).toBe(false)
        expect(isAllowedChord({ key: 'Tab', meta: true })).toBe(false)
        expect(isAllowedChord({ key: 'Tab', ctrl: true, alt: true })).toBe(false)
    })

    it('rejects keys the browser could not name (IME, dead keys)', () => {
        for (const key of ['Process', 'Dead', 'Unidentified']) {
            expect(isAllowedChord({ key, ctrl: true, alt: true })).toBe(false)
        }
    })
})

describe('isComposingKeyEvent', () => {
    it('spots key presses that belong to IME input', () => {
        expect(isComposingKeyEvent({ key: 'a', isComposing: true })).toBe(true)
        expect(isComposingKeyEvent({ key: 'a', keyCode: 229 })).toBe(true)
        expect(isComposingKeyEvent({ key: 'Process' })).toBe(true)
        expect(isComposingKeyEvent({ key: 'a', keyCode: 65 })).toBe(false)
    })
})

describe('typesAltGraphCharacter', () => {
    const pressed = (key: string, altGraph = true) => ({ key, getModifierState: (name: string) => name === 'AltGraph' && altGraph })

    it('is true when AltGr turns the key into another character or a dead key', () => {
        for (const key of ['@', 'ę', '€', '{', 'Dead']) {
            expect(typesAltGraphCharacter(pressed(key))).toBe(true)
        }
    })

    it('is false when the key keeps its own letter or digit, or is a named key', () => {
        for (const key of ['t', 'T', '1', 'F5']) {
            expect(typesAltGraphCharacter(pressed(key))).toBe(false)
        }
    })

    it("is false for a non-Latin layout's own letter, which Windows reports as AltGr under Ctrl+Alt", () => {
        // Russian Ctrl+Alt+S and Ctrl+Alt+[, Greek Ctrl+Alt+D
        for (const [key, code] of [
            ['ы', 'KeyS'],
            ['х', 'BracketLeft'],
            ['δ', 'KeyD'],
        ]) {
            expect(typesAltGraphCharacter({ ...pressed(key), code })).toBe(false)
        }
        // Symbols AltGr types there (Russian AltGr+8 = ₽) are still characters.
        expect(typesAltGraphCharacter({ ...pressed('₽'), code: 'Digit8' })).toBe(true)
        // Without a physical key to match by, the letter can't be a shortcut either.
        expect(typesAltGraphCharacter(pressed('ы'))).toBe(true)
    })

    it('is false without AltGr', () => {
        expect(typesAltGraphCharacter(pressed('@', false))).toBe(false)
        expect(typesAltGraphCharacter({ key: '@' })).toBe(false)
    })
})

describe('isAltCodeKey', () => {
    it('is true for Alt with a number-pad digit, which starts an Alt code', () => {
        expect(isAltCodeKey({ code: 'Numpad0', altKey: true })).toBe(true)
        expect(isAltCodeKey({ code: 'Numpad9', altKey: true, ctrlKey: false })).toBe(true)
    })

    it('is false for the digits row, other keys, no Alt, or Ctrl+Alt', () => {
        expect(isAltCodeKey({ code: 'Digit0', altKey: true })).toBe(false)
        expect(isAltCodeKey({ code: 'NumpadAdd', altKey: true })).toBe(false)
        expect(isAltCodeKey({ code: 'Numpad0' })).toBe(false)
        expect(isAltCodeKey({ code: 'Numpad0', altKey: true, ctrlKey: true })).toBe(false)
        expect(isAltCodeKey({ code: 'Numpad0', altKey: true, metaKey: true })).toBe(false)
        expect(isAltCodeKey({ altKey: true })).toBe(false)
    })
})

describe('baseKeyFromCode', () => {
    it('maps letter, digit and punctuation codes to US characters', () => {
        expect(baseKeyFromCode('KeyS')).toBe('s')
        expect(baseKeyFromCode('Digit1')).toBe('1')
        expect(baseKeyFromCode('Comma')).toBe(',')
        expect(baseKeyFromCode('Backslash')).toBe('\\')
    })

    it('returns null for other or missing codes', () => {
        expect(baseKeyFromCode('F1')).toBeNull()
        expect(baseKeyFromCode('Space')).toBeNull()
        expect(baseKeyFromCode(undefined)).toBeNull()
    })
})

describe('physicalKeyFallback', () => {
    it('uses the physical key for non-Latin letters', () => {
        expect(physicalKeyFallback({ key: 'ы', code: 'KeyS' })).toBe('s')
        expect(physicalKeyFallback({ key: 'α', code: 'KeyA' })).toBe('a')
        expect(physicalKeyFallback({ key: 'ש', code: 'KeyA' })).toBe('a')
    })

    it('uses the digit for Shift+digit symbols', () => {
        expect(physicalKeyFallback({ key: '!', code: 'Digit1' })).toBe('1')
        expect(physicalKeyFallback({ key: '/', code: 'Digit7' })).toBe('7')
    })

    it('uses the digit on AZERTY, where the digit keys type symbols without Shift', () => {
        expect(physicalKeyFallback({ key: '&', code: 'Digit1' })).toBe('1')
        expect(physicalKeyFallback({ key: 'é', code: 'Digit2' })).toBe('2')
        expect(physicalKeyFallback({ key: 'à', code: 'Digit0' })).toBe('0')
        // AZERTY types the digit itself with Shift.
        expect(physicalKeyFallback({ key: '1', code: 'Digit1' })).toBeNull()
    })

    it('keeps the typed key on Latin layouts and for keys that already match', () => {
        expect(physicalKeyFallback({ key: 'o', code: 'KeyS' })).toBeNull()
        expect(physicalKeyFallback({ key: 'ö', code: 'Semicolon' })).toBeNull()
        expect(physicalKeyFallback({ key: 'S', code: 'KeyS' })).toBeNull()
        expect(physicalKeyFallback({ key: '?', code: 'Slash' })).toBeNull()
        expect(physicalKeyFallback({ key: 'F1', code: 'F1' })).toBeNull()
        expect(physicalKeyFallback({ key: 'Process', code: 'KeyS' })).toBeNull()
    })
})

describe('isMacPlatform', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns false when navigator is unavailable', () => {
        vi.stubGlobal('navigator', undefined)
        expect(isMacPlatform()).toBe(false)
    })

    it('uses userAgentData.platform when available', () => {
        vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
        expect(isMacPlatform()).toBe(true)

        vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, userAgent: '' })
        expect(isMacPlatform()).toBe(false)
    })

    it('falls back to userAgent when userAgentData is missing', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })
        expect(isMacPlatform()).toBe(true)

        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
        expect(isMacPlatform()).toBe(false)
    })
})

describe('isWindowsPlatform', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns false when navigator is unavailable', () => {
        vi.stubGlobal('navigator', undefined)
        expect(isWindowsPlatform()).toBe(false)
    })

    it('uses userAgentData.platform when available, else the user agent', () => {
        vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, userAgent: '' })
        expect(isWindowsPlatform()).toBe(true)

        vi.stubGlobal('navigator', { userAgentData: { platform: 'Linux' }, userAgent: 'Windows' })
        expect(isWindowsPlatform()).toBe(false)

        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
        expect(isWindowsPlatform()).toBe(true)

        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
        expect(isWindowsPlatform()).toBe(false)
    })
})
