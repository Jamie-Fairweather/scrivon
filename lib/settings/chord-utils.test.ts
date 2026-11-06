import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    baseKeyFromCode,
    chordKey,
    chordsEqual,
    isAllowedChord,
    isComposingKeyEvent,
    isMacPlatform,
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

    it('rejects Tab, Enter, Space, Escape, Backspace, Delete and arrows even with modifiers', () => {
        for (const key of ['Tab', 'Enter', ' ', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
            expect(isAllowedChord({ key })).toBe(false)
            expect(isAllowedChord({ key, ctrl: true })).toBe(false)
        }
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

    it('is false without AltGr', () => {
        expect(typesAltGraphCharacter(pressed('@', false))).toBe(false)
        expect(typesAltGraphCharacter({ key: '@' })).toBe(false)
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
        expect(physicalKeyFallback({ key: '!', code: 'Digit1', shiftKey: true })).toBe('1')
        expect(physicalKeyFallback({ key: '/', code: 'Digit7', shiftKey: true })).toBe('7')
    })

    it('keeps the typed key on Latin layouts and for keys that already match', () => {
        expect(physicalKeyFallback({ key: 'o', code: 'KeyS' })).toBeNull()
        expect(physicalKeyFallback({ key: 'ö', code: 'Semicolon' })).toBeNull()
        expect(physicalKeyFallback({ key: 'S', code: 'KeyS', shiftKey: true })).toBeNull()
        expect(physicalKeyFallback({ key: '?', code: 'Slash', shiftKey: true })).toBeNull()
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
