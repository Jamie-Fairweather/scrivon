// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAG_START_PX, pastDragStart, swallowNextClick } from './pointer-drag'

afterEach(() => {
    vi.useRealTimers()
})

describe('pastDragStart', () => {
    it('starts a drag once the pointer has moved the start distance in any direction', () => {
        const start = { x: 10, y: 10 }
        expect(pastDragStart(start, 10 + DRAG_START_PX - 1, 10)).toBe(false)
        expect(pastDragStart(start, 10 + DRAG_START_PX, 10)).toBe(true)
        expect(pastDragStart(start, 10, 10 - DRAG_START_PX)).toBe(true)
        expect(pastDragStart(start, 12, 12)).toBe(false)
    })
})

describe('swallowNextClick', () => {
    it('stops the click that comes as the button is let go, and only that one', () => {
        const onClick = vi.fn()
        document.body.addEventListener('click', onClick)
        swallowNextClick()

        document.body.click()
        expect(onClick).not.toHaveBeenCalled()
        document.body.click()
        expect(onClick).toHaveBeenCalledTimes(1)
        document.body.removeEventListener('click', onClick)
    })

    it('lets the next click through when none came straight after the drag', () => {
        vi.useFakeTimers()
        const onClick = vi.fn()
        document.body.addEventListener('click', onClick)
        swallowNextClick()

        vi.runAllTimers()
        document.body.click()
        expect(onClick).toHaveBeenCalledTimes(1)
        document.body.removeEventListener('click', onClick)
    })

    it('lets a new press and its click through', () => {
        const onClick = vi.fn()
        document.body.addEventListener('click', onClick)
        swallowNextClick()

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        document.body.click()
        expect(onClick).toHaveBeenCalledTimes(1)
        document.body.removeEventListener('click', onClick)
    })
})
