import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    colorSelectionFromPointer,
    hexToHsl,
    hslFromSelection,
    hslToHex,
    hslToRgb,
    isEyeDropperSupported,
    selectionFromHsl,
} from '@/components/ui/color-picker'

describe('color picker helpers', () => {
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
        expect(colorSelectionFromPointer(null, 10, 10, setSaturation, setLightness)).toBeNull()
        expect(setSaturation).not.toHaveBeenCalled()
        expect(setLightness).not.toHaveBeenCalled()
    })

    it('maps pointer position onto saturation and lightness, clamping to the field', () => {
        const setSaturation = vi.fn()
        const setLightness = vi.fn()
        const last = () => [setSaturation.mock.lastCall?.[0], setLightness.mock.lastCall?.[0]]

        expect(colorSelectionFromPointer(field(), 0, 0, setSaturation, setLightness)).toEqual({ x: 0, y: 0 })
        expect(last()).toEqual([0, 100])

        expect(colorSelectionFromPointer(field(), 40, 25, setSaturation, setLightness)).toEqual({ x: 0.4, y: 0.25 })
        const [saturation, lightness] = last()
        expect(saturation).toBeCloseTo(37.5)
        expect(lightness).toBeCloseTo(60)

        expect(colorSelectionFromPointer(field(), -50, 250, setSaturation, setLightness)).toEqual({ x: 0, y: 1 })
        expect(last()).toEqual([0, 0])

        expect(colorSelectionFromPointer(field(), 500, -20, setSaturation, setLightness)).toEqual({ x: 1, y: 0 })
        expect(last()).toEqual([100, 50])
    })
})

describe('selection square colour model', () => {
    /** What the square paints at (x, y) for `hue`: the pure hue, white fading out to the right, black fading in downwards (HSV). */
    function drawnRgb(hue: number, x: number, y: number): [number, number, number] {
        const pure = hslToRgb(hue, 100, 50)
        return pure.map((channel) => Math.round((channel * x + 255 * (1 - x)) * (1 - y))) as [number, number, number]
    }

    it('picks the colour that is drawn under the pointer', () => {
        for (const hue of [0, 120, 216]) {
            for (const [x, y] of [
                [0.5, 0],
                [0.5, 0.5],
                [0.8, 0.2],
                [0.1, 0.9],
                [1, 0.3],
            ] as const) {
                const { saturation, lightness } = hslFromSelection(x, y)
                const picked = hslToRgb(hue, saturation, lightness)
                const drawn = drawnRgb(hue, x, y)
                picked.forEach((channel, index) => expect(Math.abs(channel - drawn[index]!)).toBeLessThanOrEqual(1))
            }
        }
        // The finding's example: hue 0, middle of the top edge is pink, not greyish #df9f9f.
        const topMiddle = hslFromSelection(0.5, 0)
        expect(hslToHex(0, topMiddle.saturation, topMiddle.lightness)).toBe('#ff8080')
    })

    it('places a colour back where it was picked', () => {
        for (const [x, y] of [
            [0.4, 0.25],
            [0.9, 0.6],
            [0.05, 0.05],
        ] as const) {
            const { saturation, lightness } = hslFromSelection(x, y)
            const point = selectionFromHsl(saturation, lightness)
            expect(point.x).toBeCloseTo(x)
            expect(point.y).toBeCloseTo(y)
        }
        const pink = hexToHsl('#ff8080')
        const point = selectionFromHsl(pink.saturation, pink.lightness)
        expect(point.x).toBeCloseTo(0.5, 1)
        expect(point.y).toBeCloseTo(0)
        expect(selectionFromHsl(0, 0)).toEqual({ x: 0, y: 1 })
        expect(selectionFromHsl(0, 100)).toEqual({ x: 0, y: 0 })
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
