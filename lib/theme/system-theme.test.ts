import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveThemeSetting, systemPrefersDark, watchSystemTheme, withFollowSystem, withSystemTheme } from './system-theme'

/** A stand-in for the browser's prefers-color-scheme query, which Windows switches. */
function fakeSystemTheme(dark: boolean) {
    const listeners = new Set<() => void>()
    const query = {
        matches: dark,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }
    vi.stubGlobal('window', { matchMedia: (text: string) => (text === '(prefers-color-scheme: dark)' ? query : { matches: false }) })
    return {
        listeners,
        switchTo(nextDark: boolean) {
            query.matches = nextDark
            for (const listener of listeners) listener()
        },
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('systemPrefersDark', () => {
    it('reads whether Windows is set to dark', () => {
        fakeSystemTheme(true)
        expect(systemPrefersDark()).toBe(true)

        fakeSystemTheme(false)
        expect(systemPrefersDark()).toBe(false)
    })

    it('says dark, like the default theme, when there is nothing to ask', () => {
        expect(systemPrefersDark()).toBe(true)

        vi.stubGlobal('window', {})
        expect(systemPrefersDark()).toBe(true)
    })
})

describe('watchSystemTheme', () => {
    it('reports each switch between light and dark until it is stopped', () => {
        const system = fakeSystemTheme(false)
        const seen: boolean[] = []

        const stop = watchSystemTheme((dark) => seen.push(dark))
        system.switchTo(true)
        system.switchTo(false)
        stop()
        system.switchTo(true)

        expect(seen).toEqual([true, false])
        expect(system.listeners.size).toBe(0)
    })

    it('does nothing when there is nothing to watch', () => {
        vi.stubGlobal('window', {})
        expect(() => watchSystemTheme(() => undefined)()).not.toThrow()
    })
})

describe('withFollowSystem', () => {
    it('turning it on keeps the theme on screen as the one for its kind', () => {
        const fixedDark = { id: 'nord', light: 'solarized-light', dark: 'dracula' } as const
        expect(withFollowSystem(fixedDark, true, true)).toEqual({ id: 'system', light: 'solarized-light', dark: 'nord' })

        const fixedLight = { id: 'github-light', light: 'solarized-light', dark: 'dracula' } as const
        expect(withFollowSystem(fixedLight, true, true)).toEqual({ id: 'system', light: 'github-light', dark: 'dracula' })
    })

    it('turning it off fixes the theme on screen', () => {
        const system = { id: 'system', light: 'solarized-light', dark: 'dracula' } as const

        expect(withFollowSystem(system, false, true)).toEqual({ id: 'dracula', light: 'solarized-light', dark: 'dracula' })
        expect(withFollowSystem(system, false, false)).toEqual({ id: 'solarized-light', light: 'solarized-light', dark: 'dracula' })
    })

    it('changes nothing when it is already in that mode', () => {
        const system = { id: 'system', light: 'solarized-light', dark: 'dracula' } as const
        const fixed = { id: 'nord', light: 'scrivon-light', dark: 'scrivon-dark' } as const

        expect(withFollowSystem(system, true, true)).toBe(system)
        expect(withFollowSystem(fixed, false, true)).toBe(fixed)
    })
})

describe('withSystemTheme', () => {
    it("sets System mode's dark theme to a dark theme and its light theme to a light one", () => {
        const setting = { id: 'system', light: 'scrivon-light', dark: 'scrivon-dark' } as const

        expect(withSystemTheme(setting, 'dracula')).toEqual({ id: 'system', light: 'scrivon-light', dark: 'dracula' })
        expect(withSystemTheme(setting, 'solarized-light')).toEqual({ id: 'system', light: 'solarized-light', dark: 'scrivon-dark' })
    })
})

describe('resolveThemeSetting', () => {
    it('shows a fixed theme whatever Windows is set to', () => {
        const setting = { id: 'nord', light: 'solarized-light', dark: 'dracula' } as const

        expect(resolveThemeSetting(setting, true)).toBe('nord')
        expect(resolveThemeSetting(setting, false)).toBe('nord')
    })

    it('in System mode, shows the dark theme when Windows is dark and the light theme when it is light', () => {
        const setting = { id: 'system', light: 'solarized-light', dark: 'dracula' } as const

        expect(resolveThemeSetting(setting, true)).toBe('dracula')
        expect(resolveThemeSetting(setting, false)).toBe('solarized-light')
    })
})
