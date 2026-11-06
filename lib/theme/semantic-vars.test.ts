import { describe, expect, it } from 'vitest'
import { applySemanticVars, clearSemanticVars, SEMANTIC_VAR_NAMES, tokensToSemanticVars } from './semantic-vars'
import { APP_THEME_IDS } from './catalog'
import { contrastRatio } from './color-mix'
import { resolveThemeTokensForId, type ResolvedThemeTokens } from './resolve-theme-tokens'

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
    interactive: '#2a2a2a',
    mutedText: '#aaaaaa',
    lineNumber: '#777777',
    activeLineNumber: '#bbbbbb',
    uiText: '#eeeeee',
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

    it('uses the readable UI text colour for --muted-foreground, not the diagram muted colour', () => {
        const vars = tokensToSemanticVars(sampleTokens)

        expect(vars['--muted-foreground']).toBe('#aaaaaa')
    })

    it('uses the stronger interactive fill for hover and selected states, and surface for large panels', () => {
        const vars = tokensToSemanticVars(sampleTokens)

        expect(vars['--muted']).toBe('#2a2a2a')
        expect(vars['--secondary']).toBe('#2a2a2a')
        expect(vars['--sidebar-accent']).toBe('#2a2a2a')
        expect(vars['--card']).toBe('#222222')
        expect(vars['--popover']).toBe('#222222')
        expect(vars['--code-highlight']).toBe('#222222')
    })

    it.each(APP_THEME_IDS)('%s: hover and selected fills stand out from the background', (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--muted'], vars['--background'])).toBeGreaterThanOrEqual(1.15)
        expect(contrastRatio(vars['--muted-foreground'], vars['--muted'])).toBeGreaterThanOrEqual(4.5)
    })

    it.each(APP_THEME_IDS)('%s: focus ring reaches 3:1 on the background (globals.css draws it at full strength)', (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--ring'], vars['--background'])).toBeGreaterThanOrEqual(3)
    })

    it.each(APP_THEME_IDS)('%s: body text on hover and selected fills reaches 4.5:1', (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--secondary-foreground'], vars['--secondary'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(vars['--sidebar-accent-foreground'], vars['--sidebar-accent'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(vars['--foreground'], vars['--muted'])).toBeGreaterThanOrEqual(4.5)
    })

    it.each(APP_THEME_IDS)('%s: body text stands out more than secondary text', (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--foreground'], vars['--background'])).toBeGreaterThan(
            contrastRatio(vars['--muted-foreground'], vars['--background'])
        )
    })

    it('uses the UI text colour, not the raw palette text, for body text', () => {
        const vars = tokensToSemanticVars({ ...sampleTokens, uiText: '#ffffff' })

        expect(vars['--foreground']).toBe('#ffffff')
        expect(vars['--card-foreground']).toBe('#ffffff')
        expect(vars['--popover-foreground']).toBe('#ffffff')
        expect(vars['--secondary-foreground']).toBe('#ffffff')
        expect(vars['--sidebar-accent-foreground']).toBe('#ffffff')
    })

    it.each(APP_THEME_IDS)('%s: text on highlighted rows reaches 4.5:1', (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--accent-foreground'], vars['--accent'])).toBeGreaterThanOrEqual(4.5)
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

describe('SEMANTIC_VAR_NAMES', () => {
    it('lists exactly the variables tokensToSemanticVars produces', () => {
        expect([...SEMANTIC_VAR_NAMES].sort()).toEqual(Object.keys(tokensToSemanticVars(sampleTokens)).sort())
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
