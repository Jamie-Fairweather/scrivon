import { describe, expect, it } from 'vitest'
import { hexToHsl, hslToHex, hslToRgb, normalizeColorHex } from '@/components/ui/color-picker'

describe('color picker helpers', () => {
    it('normalizes hex colours', () => {
        expect(normalizeColorHex('#abc')).toBe('#aabbcc')
        expect(normalizeColorHex('#AABBCC')).toBe('#aabbcc')
        expect(normalizeColorHex('nope')).toBeNull()
    })

    it('converts between hex and hsl', () => {
        const red = hexToHsl('#ff0000')
        expect(hslToHex(red.hue, red.saturation, red.lightness)).toBe('#ff0000')
        expect(hslToRgb(0, 0, 50)).toEqual([128, 128, 128])
        expect(hexToHsl('#808080').saturation).toBe(0)
    })
})
