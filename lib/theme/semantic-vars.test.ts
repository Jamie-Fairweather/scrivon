import { describe, expect, it } from 'vitest'
import { STATUS_COLORS, STATUS_TINT_PERCENTS, applySemanticVars, tokensToSemanticVars } from './semantic-vars'
import { APP_THEME_IDS, getTheme } from './catalog'
import { contrastRatio, hexColorMix } from './color-mix'
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

describe('status text colours', () => {
    const STATUSES = ['warning', 'destructive', 'info', 'success'] as const

    it.each(APP_THEME_IDS)('%s: warning, error, link and success text reach 4.5:1 on the backgrounds and tints they sit on', (id) => {
        const tokens = resolveThemeTokensForId(id)
        const vars = tokensToSemanticVars(tokens)
        // The tints follow the theme's kind, as globals.css's .dark class does.
        const kind = getTheme(id).kind
        for (const status of STATUSES) {
            const text = vars[`--${status}-foreground`]
            const { fill } = STATUS_COLORS[kind][status]
            // e.g. the read-only bar (bg-warning/10 over the editor) and the badges in a dialog.
            const tints = [tokens.bg, tokens.surface].flatMap((surface) =>
                STATUS_TINT_PERCENTS[kind].map((percent) => hexColorMix(fill, surface, percent))
            )
            for (const background of [tokens.bg, tokens.surface, tokens.interactive, ...tints]) {
                expect(contrastRatio(text, background), `${status} on ${background}`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })

    it.each(APP_THEME_IDS)("%s: a destructive menu item's text reaches 4.5:1 on the highlighted row", (id) => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId(id))

        expect(contrastRatio(vars['--destructive-foreground'], vars['--accent'])).toBeGreaterThanOrEqual(4.5)
    })

    it("keeps Tailwind's shades where they already pass", () => {
        const vars = tokensToSemanticVars(resolveThemeTokensForId('github-light'))

        expect(vars['--destructive-foreground']).toBe(STATUS_COLORS.light.destructive.text)
        expect(vars['--info-foreground']).toBe(STATUS_COLORS.light.info.text)
    })

    it('darkens the read-only bar text in Tokyo Light, where amber-700 was 3.3:1', () => {
        const tokens = resolveThemeTokensForId('tokyo-night-light')
        const vars = tokensToSemanticVars(tokens)
        const bar = hexColorMix(STATUS_COLORS.light.warning.fill, tokens.bg, 10)

        expect(contrastRatio(STATUS_COLORS.light.warning.text, bar)).toBeLessThan(4.5)
        expect(contrastRatio(vars['--warning-foreground'], bar)).toBeGreaterThanOrEqual(4.5)
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
