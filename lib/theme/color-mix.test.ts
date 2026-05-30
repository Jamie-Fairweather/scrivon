import { describe, expect, it } from 'vitest'
import { hexColorMix, parseHexColor, toHexColor } from './color-mix'

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
