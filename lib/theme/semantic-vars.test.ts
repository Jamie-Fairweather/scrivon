import { describe, expect, it } from 'vitest'
import { applySemanticVars, clearSemanticVars, SEMANTIC_VAR_NAMES, tokensToSemanticVars } from './semantic-vars'
import type { ResolvedThemeTokens } from './resolve-theme-tokens'

const sampleTokens: ResolvedThemeTokens = {
    bg: '#111111',
    fg: '#eeeeee',
    accent: '#aabbcc',
    muted: '#888888',
    border: '#333333',
    surface: '#222222',
    line: '#444444',
    textSecondary: '#999999',
    textFaint: '#666666',
}

function createStyleRoot() {
    const properties = new Map<string, string>()

    return {
        style: {
            setProperty(name: string, value: string) {
                properties.set(name, value)
            },
            removeProperty(name: string) {
                properties.delete(name)
            },
        },
        properties,
    }
}

describe('tokensToSemanticVars', () => {
    it('maps resolved tokens to css custom properties', () => {
        const vars = tokensToSemanticVars(sampleTokens)

        expect(vars['--background']).toBe('#111111')
        expect(vars['--foreground']).toBe('#eeeeee')
        expect(vars['--accent']).toBeTruthy()
    })
})

describe('applySemanticVars', () => {
    it('sets semantic variables on the root element', () => {
        const root = createStyleRoot()

        applySemanticVars(root as unknown as HTMLElement, sampleTokens)

        expect(root.properties.get('--background')).toBe('#111111')
        expect(root.properties.get('--foreground')).toBe('#eeeeee')
    })
})

describe('clearSemanticVars', () => {
    it('removes semantic variables from the root element', () => {
        const root = createStyleRoot()

        applySemanticVars(root as unknown as HTMLElement, sampleTokens)
        clearSemanticVars(root as unknown as HTMLElement)

        for (const name of SEMANTIC_VAR_NAMES) {
            expect(root.properties.has(name)).toBe(false)
        }
    })
})
