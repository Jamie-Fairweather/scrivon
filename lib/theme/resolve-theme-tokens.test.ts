import { describe, expect, it } from 'vitest'
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
