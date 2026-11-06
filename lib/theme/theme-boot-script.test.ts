// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from './catalog'
import { resolveThemeTokensForId } from './resolve-theme-tokens'
import { tokensToSemanticVars } from './semantic-vars'
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

    function runBootScript(savedThemeId: string) {
        const saved = new Map([[SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: savedThemeId } })]])
        vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null })
        new Function(getThemeBootScript())()
    }

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
