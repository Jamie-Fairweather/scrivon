import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STATUS_COLORS, STATUS_TINT_PERCENTS, applySemanticVars, tokensToSemanticVars } from './semantic-vars'
import { APP_THEME_IDS, getTheme } from './catalog'
import { contrastRatio, hexColorMix, toHexColor } from './color-mix'
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

describe('STATUS_COLORS', () => {
    /** OKLCH to sRGB hex, clipped to sRGB, which gives Tailwind's published hex values. */
    function oklchToHex(lightness: number, chroma: number, hue: number): string {
        const a = chroma * Math.cos((hue * Math.PI) / 180)
        const b = chroma * Math.sin((hue * Math.PI) / 180)
        const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
        const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
        const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
        const linear = [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ]
        const [r, g, bl] = linear.map((value) => {
            const v = Math.min(1, Math.max(0, value))
            return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
        })
        return toHexColor(r!, g!, bl!)
    }

    /** Tailwind's colours by name (e.g. 'red-500'), read from the theme.css the app builds with. */
    const tailwind = new Map([
        ['white', '#ffffff'],
        ['black', '#000000'],
    ])
    const theme = readFileSync(path.resolve(__dirname, '../../node_modules/tailwindcss/theme.css'), 'utf8')
    for (const [, name, l, c, h] of theme.matchAll(/--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) {
        tailwind.set(name!, oklchToHex(Number(l) / 100, Number(c), Number(h)))
    }

    /** app/globals.css without its comments. */
    const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

    /** The custom properties set in a top-level rule of app/globals.css, such as `:root`. */
    function cssVariables(selector: string): Map<string, string> {
        const start = css.indexOf(`\n${selector} {`)
        expect(start, selector).toBeGreaterThanOrEqual(0)
        const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
        return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]))
    }

    /** A colour as globals.css writes it: `var(--color-red-500)`, or a `color-mix(in srgb, ...)` of two such. */
    function cssColorToHex(value: string | undefined): string | undefined {
        const shade = /^var\(--color-([a-z]+(?:-\d+)?)\)$/.exec(value ?? '')
        if (shade) return tailwind.get(shade[1]!)
        const mix = /^color-mix\(in srgb,\s*(var\([^)]+\))\s+([\d.]+)%,\s*(var\([^)]+\))\)$/.exec(value ?? '')
        if (!mix) return undefined
        const [a, b] = [cssColorToHex(mix[1]), cssColorToHex(mix[3])]
        return a && b ? hexColorMix(a, b, Number(mix[2])) : undefined
    }

    // The theme steps the text from these colours and checks it on tints of these fills, so a fill
    // changed only in globals.css would leave that check measuring colours the app no longer draws.
    it.each([
        ['light', ':root'],
        ['dark', '.dark'],
    ] as const)('match the %s colours app/globals.css sets in %s', (kind, selector) => {
        const vars = cssVariables(selector)
        for (const [status, { fill, text }] of Object.entries(STATUS_COLORS[kind])) {
            expect(cssColorToHex(vars.get(`--${status}`)), `--${status}: ${vars.get(`--${status}`)}`).toBe(fill)
            expect(cssColorToHex(vars.get(`--${status}-foreground`)), `--${status}-foreground: ${vars.get(`--${status}-foreground`)}`).toBe(text)
        }
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
