import { describe, expect, it } from 'vitest'
import { APP_THEME_IDS, getDiagramColors } from './catalog'
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
            activeLineNumber: expect.any(String),
            uiText: expect.any(String),
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

    it.each(APP_THEME_IDS)('%s: the current line number stands out more than the other line numbers', (id) => {
        const tokens = resolveThemeTokensForId(id)

        expect(contrastRatio(tokens.activeLineNumber, tokens.bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(tokens.activeLineNumber, tokens.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(tokens.activeLineNumber, tokens.bg)).toBeGreaterThanOrEqual(contrastRatio(tokens.lineNumber, tokens.bg) + 1)
    })

    it.each(APP_THEME_IDS)('%s: body text stands out more than secondary text', (id) => {
        const tokens = resolveThemeTokensForId(id)

        for (const background of [tokens.bg, tokens.surface, tokens.interactive]) {
            expect(contrastRatio(tokens.uiText, background)).toBeGreaterThan(contrastRatio(tokens.mutedText, background))
        }
        expect(contrastRatio(tokens.uiText, tokens.bg)).toBeGreaterThanOrEqual(contrastRatio(tokens.mutedText, tokens.bg) + 1)
    })

    it('keeps the palette text colour as UI text when it already out-ranks secondary text', () => {
        const tokens = resolveThemeTokensForId('scrivon-light')

        expect(tokens.uiText).toBe(tokens.fg)
    })

    it('pushes soft palette text (Solarized) further from the background for the UI only', () => {
        const tokens = resolveThemeTokensForId('solarized-light')

        expect(tokens.fg).toBe(getDiagramColors('solarized-light').fg)
        expect(tokens.uiText).not.toBe(tokens.fg)
        expect(contrastRatio(tokens.uiText, tokens.bg)).toBeGreaterThan(contrastRatio(tokens.fg, tokens.bg))
    })

    it('keeps the diagram muted colour separate from UI text', () => {
        const tokens = resolveThemeTokensForId('tokyo-night')

        expect(tokens.muted).toBe('#565f89')
        expect(tokens.mutedText).not.toBe(tokens.muted)
    })
})
