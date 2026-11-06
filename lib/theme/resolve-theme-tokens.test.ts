import { describe, expect, it } from 'vitest'
import { APP_THEME_IDS } from './catalog'
import { contrastRatio } from './color-mix'
import { resolveThemeTokens, resolveThemeTokensForId } from './resolve-theme-tokens'

describe('resolveThemeTokens', () => {
    it('derives missing palette fields from bg and fg', () => {
        const tokens = resolveThemeTokens({ bg: '#ffffff', fg: '#000000' })

        expect(tokens).toMatchObject({
            bg: '#ffffff',
            fg: '#000000',
            accent: expect.any(String),
            muted: expect.any(String),
            border: expect.any(String),
            surface: expect.any(String),
            line: expect.any(String),
            textSecondary: expect.any(String),
            textFaint: expect.any(String),
            interactive: expect.any(String),
            mutedText: expect.any(String),
            lineNumber: expect.any(String),
        })
    })

    it('preserves explicit diagram color overrides', () => {
        const tokens = resolveThemeTokens({
            bg: '#ffffff',
            fg: '#000000',
            accent: '#ff00ff',
            muted: '#00ff00',
            border: '#0000ff',
            surface: '#abcdef',
            line: '#fedcba',
        })

        expect(tokens).toMatchObject({
            accent: '#ff00ff',
            muted: '#00ff00',
            border: '#0000ff',
            surface: '#abcdef',
            line: '#fedcba',
        })
    })
})

describe('resolveThemeTokensForId', () => {
    it('resolves tokens for a registered theme id', () => {
        const tokens = resolveThemeTokensForId('scrivon-dark')

        expect(tokens.bg).toBeTruthy()
        expect(tokens.fg).toBeTruthy()
    })
})

describe('UI text contrast', () => {
    it.each(APP_THEME_IDS)('%s: secondary text reaches 4.5:1 on the background and surfaces', (id) => {
        const tokens = resolveThemeTokensForId(id)

        expect(contrastRatio(tokens.mutedText, tokens.bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(tokens.mutedText, tokens.surface)).toBeGreaterThanOrEqual(4.5)
    })

    it.each(APP_THEME_IDS)('%s: editor line numbers reach 3:1', (id) => {
        const tokens = resolveThemeTokensForId(id)

        expect(contrastRatio(tokens.lineNumber, tokens.bg)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(tokens.lineNumber, tokens.surface)).toBeGreaterThanOrEqual(3)
    })

    it('keeps the diagram muted colour separate from UI text', () => {
        const tokens = resolveThemeTokensForId('tokyo-night')

        expect(tokens.muted).toBe('#565f89')
        expect(tokens.mutedText).not.toBe(tokens.muted)
    })
})
