import { afterEach, describe, expect, it, vi } from 'vitest'
import { colorSelectionFromPointer, hexToHsl, hslToHex, hslToRgb, isEyeDropperSupported, normalizeColorHex } from '@/components/ui/color-picker'

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

    it('covers the remaining hue, lightness, and clamp paths', () => {
        expect(hexToHsl('nope')).toEqual({ hue: 0, saturation: 0, lightness: 0, alpha: 100 })
        expect(hexToHsl('#ff8080')).toMatchObject({ hue: 0, saturation: 100, lightness: 75.1 })
        expect(hexToHsl('#800000')).toMatchObject({ hue: 0, saturation: 100, lightness: 25.1 })
        expect(hexToHsl('#ff0080').hue).toBe(330)
        expect(hexToHsl('#00ff00').hue).toBe(120)
        expect(hexToHsl('#0000ff').hue).toBe(240)

        expect(hslToRgb(216, 100, 50)).toEqual([0, 102, 255])
        expect(hslToHex(216, 100, 50)).toBe('#0066ff')
        expect(hslToHex(300, 100, 50)).toBe('#ff00ff')
        expect(hslToHex(0, 100, 25)).toBe('#800000')
        expect(hslToHex(180, 100, 40)).toBe('#00cccc')
        expect(hslToHex(-30, 150, -5, 150)).toBe('#000000')
        expect(hslToHex(400, -20, 200, -10)).toBe('#ffffff00')
    })
})

describe('colorSelectionFromPointer', () => {
    function field(width = 100, height = 100): Pick<HTMLElement, 'getBoundingClientRect'> {
        return { getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) as DOMRect }
    }

    it('ignores a pointer when the field is not mounted', () => {
        const setSaturation = vi.fn()
        const setLightness = vi.fn()
        colorSelectionFromPointer(null, 10, 10, setSaturation, setLightness)
        expect(setSaturation).not.toHaveBeenCalled()
        expect(setLightness).not.toHaveBeenCalled()
    })

    it('maps pointer position onto saturation and lightness, clamping to the field', () => {
        const setSaturation = vi.fn()
        const setLightness = vi.fn()

        colorSelectionFromPointer(field(), 0, 0, setSaturation, setLightness)
        expect(setSaturation).toHaveBeenCalledWith(0)
        expect(setLightness).toHaveBeenCalledWith(100)

        colorSelectionFromPointer(field(), 40, 25, setSaturation, setLightness)
        expect(setSaturation).toHaveBeenCalledWith(40)
        expect(setLightness).toHaveBeenCalledWith(60)

        colorSelectionFromPointer(field(), -50, 250, setSaturation, setLightness)
        expect(setSaturation).toHaveBeenLastCalledWith(0)
        expect(setLightness).toHaveBeenLastCalledWith(0)

        colorSelectionFromPointer(field(), 500, -20, setSaturation, setLightness)
        expect(setSaturation).toHaveBeenLastCalledWith(100)
        expect(setLightness).toHaveBeenLastCalledWith(50)
    })
})

describe('isEyeDropperSupported', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('requires a window that exposes EyeDropper', () => {
        vi.stubGlobal('window', undefined)
        expect(isEyeDropperSupported()).toBe(false)
        vi.stubGlobal('window', {})
        expect(isEyeDropperSupported()).toBe(false)
        vi.stubGlobal('window', { EyeDropper: class EyeDropper {} })
        expect(isEyeDropperSupported()).toBe(true)
    })
})
