import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('isAppThemeId', () => {
    it('accepts registered theme ids', () => {
        expect(isAppThemeId('scrivon-dark')).toBe(true)
    })

    it('rejects unknown values', () => {
        expect(isAppThemeId('not-a-theme')).toBe(false)
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
