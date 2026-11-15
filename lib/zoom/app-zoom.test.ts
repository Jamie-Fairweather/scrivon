import { describe, expect, it } from 'vitest'
import { createWheelZoom, formatZoomPercent, normalizeAppZoom, zoomInStep, zoomOutStep } from '@/lib/zoom/app-zoom'

describe('app zoom steps', () => {
    it('zooms in and out a step at a time, as browsers do', () => {
        expect(zoomInStep(1)).toBe(1.1)
        expect(zoomInStep(1.1)).toBe(1.25)
        expect(zoomOutStep(1)).toBe(0.9)
        expect(zoomOutStep(0.9)).toBe(0.8)
    })

    it('stops at 50% and 200%', () => {
        expect(zoomInStep(2)).toBe(2)
        expect(zoomOutStep(0.5)).toBe(0.5)
    })

    it('moves to the next step from a zoom between two steps', () => {
        expect(zoomInStep(1.2)).toBe(1.25)
        expect(zoomOutStep(1.2)).toBe(1.1)
    })

    it('shows the zoom as a percentage', () => {
        expect(formatZoomPercent(1)).toBe('100%')
        expect(formatZoomPercent(1.25)).toBe('125%')
        expect(formatZoomPercent(0.67)).toBe('67%')
    })
})

describe('createWheelZoom', () => {
    it('steps once per mouse wheel notch: up zooms in, down zooms out', () => {
        const wheel = createWheelZoom()
        expect(wheel({ deltaY: -100, deltaMode: 0 })).toBe(1)
        expect(wheel({ deltaY: 100, deltaMode: 0 })).toBe(-1)
        // A wheel that scrolls by lines, not pixels.
        expect(wheel({ deltaY: -3, deltaMode: 1 })).toBe(1)
    })

    it('adds up the small movements of a touchpad pinch before taking a step', () => {
        const wheel = createWheelZoom()
        expect([1, 2, 3, 4].map(() => wheel({ deltaY: -12, deltaMode: 0 }))).toEqual([0, 0, 0, 0])
        expect(wheel({ deltaY: -12, deltaMode: 0 })).toBe(1)
        // Starts adding up again after a step.
        expect(wheel({ deltaY: -12, deltaMode: 0 })).toBe(0)
    })

    it('starts again when the pinch changes direction', () => {
        const wheel = createWheelZoom()
        expect(wheel({ deltaY: -40, deltaMode: 0 })).toBe(0)
        expect(wheel({ deltaY: 40, deltaMode: 0 })).toBe(0)
        expect(wheel({ deltaY: 20, deltaMode: 0 })).toBe(-1)
    })

    it('ignores sideways movement', () => {
        expect(createWheelZoom()({ deltaY: 0, deltaMode: 0 })).toBe(0)
    })
})

describe('normalizeAppZoom', () => {
    it('keeps a saved step', () => {
        expect(normalizeAppZoom(1.5)).toBe(1.5)
    })

    it('uses 100% when nothing usable was saved', () => {
        expect(normalizeAppZoom(undefined)).toBe(1)
        expect(normalizeAppZoom('1.5')).toBe(1)
        expect(normalizeAppZoom(Number.NaN)).toBe(1)
        expect(normalizeAppZoom(0)).toBe(1)
    })

    it('moves a saved zoom to the nearest step, within 50% to 200%', () => {
        expect(normalizeAppZoom(1.12)).toBe(1.1)
        expect(normalizeAppZoom(0.1)).toBe(0.5)
        expect(normalizeAppZoom(9)).toBe(2)
    })
})
