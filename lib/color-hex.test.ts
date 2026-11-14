import { describe, expect, it } from 'vitest'
import { normalizeColorHex } from '@/lib/color-hex'

describe('normalizeColorHex', () => {
    it('normalizes hex colours', () => {
        expect(normalizeColorHex('#abc')).toBe('#aabbcc')
        expect(normalizeColorHex('#AABBCC')).toBe('#aabbcc')
        expect(normalizeColorHex(' #abc8 ')).toBe('#aabbcc88')
        expect(normalizeColorHex('#AABBCC80')).toBe('#aabbcc80')
        expect(normalizeColorHex('nope')).toBeNull()
        expect(normalizeColorHex('#abcde')).toBeNull()
        expect(normalizeColorHex('red')).toBeNull()
        expect(normalizeColorHex('#fff} body{color:red')).toBeNull()
    })

    it('drops a fully opaque alpha channel', () => {
        expect(normalizeColorHex('#aabbccff')).toBe('#aabbcc')
        expect(normalizeColorHex('#abcf')).toBe('#aabbcc')
    })
})
