import { describe, expect, it } from 'vitest'
import { contrastRatio, ensureContrast, hexColorMix, parseHexColor, relativeLuminance, toHexColor } from './color-mix'

describe('parseHexColor', () => {
    it('parses 6-digit hex with or without hash', () => {
        expect(parseHexColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 })
        expect(parseHexColor('00ff00')).toEqual({ r: 0, g: 255, b: 0 })
    })

    it('returns null for invalid input', () => {
        expect(parseHexColor('not-a-color')).toBeNull()
        expect(parseHexColor('#fff')).toBeNull()
    })
})

describe('toHexColor', () => {
    it('formats channels and clamps values', () => {
        expect(toHexColor(255, 0, 128)).toBe('#ff0080')
        expect(toHexColor(300, -10, 64.4)).toBe('#ff0040')
    })
})

describe('hexColorMix', () => {
    it('mixes foreground into background at the given percentage', () => {
        expect(hexColorMix('#ffffff', '#000000', 50)).toBe('#808080')
    })

    it('returns foreground when colors are invalid', () => {
        expect(hexColorMix('invalid', '#000000', 50)).toBe('invalid')
    })
})

describe('relativeLuminance', () => {
    it('follows the WCAG formula', () => {
        expect(relativeLuminance('#000000')).toBe(0)
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1)
        expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3)
    })

    it('returns null for invalid input', () => {
        expect(relativeLuminance('nope')).toBeNull()
    })
})

describe('contrastRatio', () => {
    it('matches known WCAG ratios', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21)
        expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
        expect(contrastRatio('#123456', '#123456')).toBe(1)
    })

    it('treats invalid colours as no contrast', () => {
        expect(contrastRatio('nope', '#ffffff')).toBe(1)
    })
})

describe('ensureContrast', () => {
    it('keeps a colour that already passes', () => {
        expect(ensureContrast('#595959', '#000000', ['#ffffff'], 4.5)).toBe('#595959')
    })

    it('darkens a pale colour toward the text colour on a light background', () => {
        const result = ensureContrast('#a8a8a8', '#262626', ['#ffffff', '#f8f8f8'], 4.5)

        expect(contrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(result, '#f8f8f8')).toBeGreaterThanOrEqual(4.5)
        // Only as far as needed: not all the way to the text colour.
        expect(contrastRatio(result, '#ffffff')).toBeLessThan(contrastRatio('#262626', '#ffffff'))
    })

    it('goes past a low-contrast text colour toward black or white when needed', () => {
        // Solarized Light: the text colour itself is only about 4.1:1 on the background.
        const result = ensureContrast('#93a1a1', '#657b83', ['#fdf6e3'], 4.5)
        expect(contrastRatio(result, '#fdf6e3')).toBeGreaterThanOrEqual(4.5)

        const onDark = ensureContrast('#586e75', '#839496', ['#002b36'], 5)
        expect(contrastRatio(onDark, '#002b36')).toBeGreaterThanOrEqual(5)
        expect(relativeLuminance(onDark)!).toBeGreaterThan(relativeLuminance('#839496')!)
    })

    it('falls back to black or white when nothing else reaches the target', () => {
        expect(ensureContrast('#777777', '#777777', ['#ffffff'], 21)).toBe('#000000')
        expect(ensureContrast('#777777', '#777777', ['#000000'], 21)).toBe('#ffffff')
    })
})
