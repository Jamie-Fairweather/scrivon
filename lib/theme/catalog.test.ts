import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeStoredSettings } from '@/lib/settings/migrate'
import {
    APP_THEME_IDS,
    DEFAULT_APP_THEME,
    getDiagramColors,
    getSystemPreferredTheme,
    getTheme,
    isAppThemeId,
    isLightTheme,
    parseStoredTheme,
    SYSTEM_DARK_THEME,
    SYSTEM_LIGHT_THEME,
} from './catalog'
import { resolveThemeSetting } from './system-theme'

describe('isAppThemeId', () => {
    it('accepts registered theme ids', () => {
        expect(isAppThemeId('scrivon-dark')).toBe(true)
    })

    it('rejects unknown values', () => {
        expect(isAppThemeId('not-a-theme')).toBe(false)
    })

    it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])('rejects the inherited object key %s', (key) => {
        expect(isAppThemeId(key)).toBe(false)
    })

    it('rejects values that are not strings', () => {
        expect(isAppThemeId(['scrivon-dark'])).toBe(false)
        expect(isAppThemeId(null)).toBe(false)
        expect(isAppThemeId(42)).toBe(false)
    })
})

describe('stored settings with a bad theme id', () => {
    it.each(['constructor', '__proto__', 'toString'])('falls back to a real theme for %s instead of crashing the theme lookup', (id) => {
        const merged = mergeStoredSettings({ theme: { id, light: id, dark: id } })

        for (const systemIsDark of [true, false]) {
            const shown = resolveThemeSetting(merged.theme, systemIsDark)
            expect(APP_THEME_IDS).toContain(shown)
            expect(() => getDiagramColors(shown).bg).not.toThrow()
        }
    })
})

describe('getTheme', () => {
    it('returns the theme definition for a known id', () => {
        expect(getTheme('scrivon-light')).toMatchObject({ kind: 'light', label: 'Scrivon Light' })
    })
})

describe('getDiagramColors', () => {
    it('returns diagram colors for a theme', () => {
        expect(getDiagramColors('scrivon-dark')).toMatchObject({ bg: expect.any(String), fg: expect.any(String) })
    })
})

describe('isLightTheme', () => {
    it('reports light and dark themes correctly', () => {
        expect(isLightTheme('scrivon-light')).toBe(true)
        expect(isLightTheme('scrivon-dark')).toBe(false)
    })
})

describe('getSystemPreferredTheme', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('falls back when window is unavailable', () => {
        expect(getSystemPreferredTheme()).toBe(DEFAULT_APP_THEME)
    })

    it('prefers dark when matchMedia reports dark mode', () => {
        vi.stubGlobal('window', {
            matchMedia: () => ({ matches: true }),
        })

        expect(getSystemPreferredTheme()).toBe(SYSTEM_DARK_THEME)
    })

    it('prefers light when matchMedia reports light mode', () => {
        vi.stubGlobal('window', {
            matchMedia: () => ({ matches: false }),
        })

        expect(getSystemPreferredTheme()).toBe(SYSTEM_LIGHT_THEME)
    })
})

describe('parseStoredTheme', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns stored theme when valid', () => {
        expect(parseStoredTheme('tokyo-night')).toBe('tokyo-night')
    })

    it('falls back to system preference when stored value is missing or invalid', () => {
        vi.stubGlobal('window', {
            matchMedia: () => ({ matches: true }),
        })

        expect(parseStoredTheme(null)).toBe(SYSTEM_DARK_THEME)
        expect(parseStoredTheme('invalid-theme')).toBe(SYSTEM_DARK_THEME)
    })
})
