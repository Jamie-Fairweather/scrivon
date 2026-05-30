import { afterEach, describe, expect, it, vi } from 'vitest'
import { chordKey, chordsEqual, isMacPlatform, normalizeChord } from '@/lib/settings/chord-utils'

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
