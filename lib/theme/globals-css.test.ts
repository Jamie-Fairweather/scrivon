import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, hexColorMix, relativeLuminance } from '@/lib/theme/color-mix'

/** app/globals.css without its comments. */
const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The inside of the first `@media <query> { ... }` block, or '' when there is none. */
function mediaBlock(query: string): string {
    const start = css.indexOf(`@media ${query} {`)
    if (start < 0) return ''
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
    }
    return ''
}

/** Tailwind's colour palette (oklch), as `name -> value`. */
const tailwindTheme = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')

/** The value `selector { name: value }` sets at the top level of globals.css, with `var(--color-*)` looked up in Tailwind's palette. */
function themeColor(selector: string, name: string): string {
    const start = css.indexOf(`${selector} {`)
    const block = css.slice(start, css.indexOf('}', start))
    const value = new RegExp(String.raw`${name}:\s*([^;]+);`).exec(block)?.[1]?.trim() ?? ''
    const palette = /^var\((--color-[a-z]+-\d+)\)$/.exec(value)?.[1]
    if (!palette) return value
    return paletteColor(palette)
}

/** A colour in Tailwind's palette (oklch), such as `--color-red-500`. */
function paletteColor(name: string): string {
    return new RegExp(String.raw`${name}:\s*([^;]+);`).exec(tailwindTheme)?.[1]?.trim() ?? ''
}

/** A colour themeColor finds, as sRGB hex: a palette shade, or `color-mix(in srgb, <shade> N%, var(--color-white))`. */
function themeColorHex(selector: string, name: string): string {
    const value = themeColor(selector, name)
    const mix = /^color-mix\(in srgb, var\((--color-[a-z]+-\d+)\) ([\d.]+)%, var\(--color-white\)\)$/.exec(value)
    if (!mix) return oklchToHex(value)
    return hexColorMix(oklchToHex(paletteColor(mix[1]!)), '#ffffff', Number(mix[2]))
}

/** An `oklch(L% C h)` colour as sRGB hex, clipped to the sRGB range like the browser does. */
function oklchToHex(value: string): string {
    const [lightness, chroma, hue] = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(value)!.slice(1).map(Number) as [number, number, number]
    const L = lightness / 100
    const a = chroma * Math.cos((hue * Math.PI) / 180)
    const b = chroma * Math.sin((hue * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    const channel = (c: number) => {
        const clipped = Math.min(1, Math.max(0, c))
        const srgb = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055
        return Math.round(srgb * 255)
            .toString(16)
            .padStart(2, '0')
    }
    return `#${linear.map(channel).join('')}`
}

/** Each selector in `block` with the declarations of its rule, e.g. 'animation: none'. */
function rulesIn(block: string): Map<string, string[]> {
    const rules = new Map<string, string[]>()
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declarations = body!
            .split(';')
            .map((d) => d.trim().replace(/\s*:\s*/, ': '))
            .filter(Boolean)
        for (const selector of selectors!.split(',')) rules.set(selector.trim(), declarations)
    }
    return rules
}

describe('app/globals.css', () => {
    it('lets the find box tooltips past the clips marked data-find-overflow-host, and only those', () => {
        const rules = [...css.matchAll(/([^{}]+)\{\s*overflow:\s*visible;?\s*\}/g)]
        const selectors = rules.flatMap((rule) => rule[1].split(',').map((selector) => selector.trim()))
        expect(selectors).toEqual(['[data-find-overflow-host]:has(.monaco-editor .find-widget.visible)'])
    })

    describe('with reduced motion', () => {
        const rules = rulesIn(mediaBlock('(prefers-reduced-motion: reduce)'))

        it('stops toasts shaking and bouncing when they are updated', () => {
            for (const name of ['error-odd', 'error-even', 'success-odd', 'success-even']) {
                expect(rules.get(`.animate-toast-${name}`), name).toContain('animation: none')
            }
        })

        it('keeps the fades but drops the slides and zooms of toasts, dialogs and other popups', () => {
            expect(rules.get("[data-slot='toast-viewport'] [data-position]")).toContain('transition-property: opacity')
            expect(rules.get("[data-slot$='-popup']")).toContain('transition-property: opacity')
        })

        it('keeps an open popup in place when its anchor moves or it flips side', () => {
            expect(rules.get("[data-slot$='-positioner']")).toContain('transition: none')
        })

        it('opens accordions and collapsible panels, and turns their chevrons, at once', () => {
            for (const slot of ['accordion-panel', 'accordion-indicator', 'collapsible-panel', 'collapsible-indicator']) {
                expect(rules.get(`[data-slot='${slot}']`), slot).toContain('transition: none')
            }
        })

        it('keeps the loading spinners turning', () => {
            const selectors = [...rules.keys()]
            expect(selectors.length).toBeGreaterThan(0)
            expect(selectors.filter((selector) => selector === '*' || selector.includes('animate-spin'))).toEqual([])
        })
    })

    describe('the red fill of Delete and Restore buttons', () => {
        it('keeps their white text at 4.5:1 in light themes, also at 90% on hover over a dialog', () => {
            const fill = themeColorHex(':root', '--destructive-fill')
            expect(contrastRatio('#ffffff', fill)).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio('#ffffff', hexColorMix(fill, '#ffffff', 90))).toBeGreaterThanOrEqual(4.5)
        })

        it('keeps their white text at 4.5:1 in dark themes', () => {
            expect(contrastRatio('#ffffff', themeColorHex('.dark', '--destructive-fill'))).toBeGreaterThanOrEqual(4.5)
        })

        it('leaves the lighter red for the faint borders and rings of invalid fields in dark themes', () => {
            // The button's darker red would make those borders about a quarter fainter on a dark background.
            const tint = relativeLuminance(themeColorHex('.dark', '--destructive'))!
            expect(tint).toBeGreaterThan(relativeLuminance(themeColorHex('.dark', '--destructive-fill'))!)
        })
    })

    describe('in Windows Contrast themes', () => {
        const rules = rulesIn(mediaBlock('(forced-colors: active)'))

        it('fills selected, current and pressed items with Highlight', () => {
            for (const selector of ["[aria-pressed='true']", "[aria-current='page']", "[role='tab'][aria-selected='true']"]) {
                expect(rules.get(selector), selector).toContain('background-color: Highlight')
            }
        })

        it('draws the focus ring on those filled items in HighlightText, inside the fill', () => {
            for (const item of [
                "[aria-pressed='true']",
                "[aria-current='page']",
                "[role='tab'][aria-selected='true']",
                "[role='treeitem'][aria-selected='true']",
            ]) {
                const declarations = rules.get(`${item}:focus-visible`)
                expect(declarations, item).toContain('outline: 2px solid HighlightText')
                const offset = declarations?.find((d) => d.startsWith('outline-offset: '))
                expect(offset, item).toMatch(/^outline-offset: -\d+px$/)
            }
        })
    })
})
