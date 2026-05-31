import { describe, expect, it } from 'vitest'
import { getSvgDimensions } from './svg-dimensions'

describe('getSvgDimensions', () => {
    it('prefers viewBox dimensions', () => {
        const svg = '<svg viewBox="0 0 800 600" width="100" height="100"></svg>'
        expect(getSvgDimensions(svg)).toEqual({ width: 800, height: 600 })
    })

    it('falls back to width and height attributes', () => {
        const svg = '<svg width="400" height="300"></svg>'
        expect(getSvgDimensions(svg)).toEqual({ width: 400, height: 300 })
    })

    it('returns null for invalid or missing dimensions', () => {
        expect(getSvgDimensions('<svg></svg>')).toBeNull()
        expect(getSvgDimensions('<svg viewBox="0 0 0 0"></svg>')).toBeNull()
        expect(getSvgDimensions('<svg width="0" height="100"></svg>')).toBeNull()
        expect(getSvgDimensions('not svg')).toBeNull()
    })
})
