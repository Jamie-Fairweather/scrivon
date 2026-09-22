import { describe, expect, it } from 'vitest'
import { hexToHsl, hslToHex, hslToRgb, normalizeColorHex } from '@/components/ui/color-picker'

describe('color picker helpers', () => {
    it('normalizes hex colours', () => {
        expect(normalizeColorHex('#abc')).toBe('#aabbcc')
        expect(normalizeColorHex('#AABBCC')).toBe('#aabbcc')
        expect(normalizeColorHex(' #abc8 ')).toBe('#aabbcc88')
        expect(normalizeColorHex('#AABBCC80')).toBe('#aabbcc80')
        expect(normalizeColorHex('nope')).toBeNull()
        expect(normalizeColorHex('#abcde')).toBeNull()
    })

    it('drops a fully opaque alpha channel', () => {
        expect(normalizeColorHex('#aabbccff')).toBe('#aabbcc')
        expect(normalizeColorHex('#abcf')).toBe('#aabbcc')
    })

    it('converts between hex and hsl', () => {
        const red = hexToHsl('#ff0000')
        expect(red.alpha).toBe(100)
        expect(hslToHex(red.hue, red.saturation, red.lightness)).toBe('#ff0000')
        expect(hslToRgb(0, 0, 50)).toEqual([128, 128, 128])
        expect(hexToHsl('#808080').saturation).toBe(0)
    })

    it('carries alpha through both directions', () => {
        const translucent = hexToHsl('#ff000080')
        expect(translucent.alpha).toBe(50)
        expect(hslToHex(translucent.hue, translucent.saturation, translucent.lightness, translucent.alpha)).toBe('#ff000080')
        expect(hslToHex(0, 100, 50, 100)).toBe('#ff0000')
        expect(hslToHex(0, 100, 50, 0)).toBe('#ff000000')
    })
})
