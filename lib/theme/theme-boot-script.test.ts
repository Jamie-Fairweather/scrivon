// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeStoredSettings } from '@/lib/settings/migrate'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import { STORAGE_MERMAID_THEME } from '@/lib/workspace/types'
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from './catalog'
import { resolveThemeTokensForId } from './resolve-theme-tokens'
import { tokensToSemanticVars } from './semantic-vars'
import { resolveThemeSetting } from './system-theme'
import { getThemeBootScript, jsonForInlineScript } from './theme-boot-script'

describe('jsonForInlineScript', () => {
    it('escapes angle brackets so values cannot break out of script tags', () => {
        const payload = '</script><script>alert(1)</script>'
        const embedded = jsonForInlineScript(payload)

        expect(embedded).not.toContain('</script>')
        expect(embedded).toContain('\\u003c/script>')
        expect(JSON.parse(embedded)).toBe(payload)
    })
})

describe('getThemeBootScript', () => {
    it('does not embed raw script-tag closers in generated source', () => {
        const script = getThemeBootScript()

        expect(script).toMatch(/^\(function\(\)\{try\{/)
        expect(script).not.toMatch(/<\/script>/i)
    })

    it('embeds parseable theme data literals', () => {
        const script = getThemeBootScript()
        const themesMatch = script.match(/var themes=(\{.*?\});var id=/)

        expect(themesMatch).not.toBeNull()

        const themes = JSON.parse(themesMatch![1]!)

        expect(themes['scrivon-dark']).toEqual(
            expect.objectContaining({
                kind: 'dark',
                vars: expect.objectContaining({ '--background': expect.any(String) }),
            })
        )
    })

    it('falls back to the same system themes as the catalog', () => {
        const script = getThemeBootScript()

        expect(script).toContain(`?${JSON.stringify(SYSTEM_DARK_THEME)}:${JSON.stringify(SYSTEM_LIGHT_THEME)}`)
    })
})

describe('getThemeBootScript at runtime', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        const root = document.documentElement
        root.removeAttribute('style')
        root.removeAttribute('data-app-theme')
        root.classList.remove('dark')
    })

    function runBootScript(savedThemeId: string, saved = new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: savedThemeId } })]])) {
        vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null })
        new Function(getThemeBootScript())()
    }

    function runInSystemMode(windowsIsDark: boolean, theme: Record<string, unknown>, legacyTheme?: string) {
        vi.stubGlobal('matchMedia', () => ({ matches: windowsIsDark }))
        const saved = new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: 'system', ...theme } })]])
        if (legacyTheme) saved.set(STORAGE_MERMAID_THEME, legacyTheme)
        runBootScript('system', saved)
        return document.documentElement.dataset.appTheme
    }

    it("in System mode, paints the light or dark theme that matches Windows, like React's", () => {
        const theme = { light: 'solarized-light', dark: 'dracula' } as const
        for (const dark of [true, false]) {
            expect(runInSystemMode(dark, theme)).toBe(resolveThemeSetting({ id: 'system', ...theme }, dark))
        }
        expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('in System mode, falls back to Scrivon Light or Dark for a theme it does not know, not to the old saved theme', () => {
        expect(runInSystemMode(true, { light: 'solarized-light', dark: 'future-theme' }, 'nord')).toBe(SYSTEM_DARK_THEME)
        expect(runInSystemMode(false, {}, 'nord')).toBe(SYSTEM_LIGHT_THEME)
    })

    it.each([
        ['a fixed theme', { id: 'nord', light: 'solarized-light', dark: 'dracula' }],
        ['System mode', { id: 'system', light: 'solarized-light', dark: 'dracula' }],
        ['a theme from a newer version, with light and dark picks', { id: 'future-theme', light: 'solarized-light', dark: 'dracula' }],
        ['a theme from a newer version, with no picks', { id: 'future-theme' }],
        ['System mode with picks of the wrong kind', { id: 'system', light: 'dracula', dark: 'solarized-light' }],
        ['System mode with picks that are not strings', { id: 'system', light: ['solarized-light'], dark: { id: 'dracula' } }],
        ['an object key as the theme', { id: 'constructor', light: 'toString', dark: '__proto__' }],
    ])('paints the same theme as React for %s', (_name, theme) => {
        for (const windowsIsDark of [true, false]) {
            vi.stubGlobal('matchMedia', () => ({ matches: windowsIsDark }))
            runBootScript('', new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ theme })]]))

            const react = resolveThemeSetting(mergeStoredSettings({ theme }).theme, windowsIsDark)
            expect(document.documentElement.dataset.appTheme, `Windows ${windowsIsDark ? 'dark' : 'light'}`).toBe(react)
        }
    })

    it('applies the saved dark theme with a dark colour scheme before React loads', () => {
        runBootScript('nord')

        const root = document.documentElement
        expect(root.dataset.appTheme).toBe('nord')
        expect(root.classList.contains('dark')).toBe(true)
        expect(root.style.colorScheme).toBe('dark')
        expect(root.style.getPropertyValue('--background')).not.toBe('')
    })

    it('applies every theme variable React would apply, with the same values', () => {
        runBootScript('dracula')

        const root = document.documentElement
        const expected = tokensToSemanticVars(resolveThemeTokensForId('dracula'))
        for (const [name, value] of Object.entries(expected)) {
            expect(root.style.getPropertyValue(name), name).toBe(value)
        }
    })

    it('uses a light colour scheme for a saved light theme', () => {
        runBootScript('solarized-light')

        expect(document.documentElement.classList.contains('dark')).toBe(false)
        expect(document.documentElement.style.colorScheme).toBe('light')
    })

    it.each(['constructor', 'toString', '__proto__'])('falls back to the system theme when the saved id is the object key %s', (id) => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }))
        runBootScript(id)

        const root = document.documentElement
        expect(root.dataset.appTheme).toBe(SYSTEM_DARK_THEME)
        expect(root.style.getPropertyValue('--background')).not.toBe('')
    })
})
