import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFrameSyncedValue } from './use-frame-synced-value'

describe('useFrameSyncedValue', () => {
    let frames: FrameRequestCallback[] = []

    beforeEach(() => {
        frames = []
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            frames.push(cb)
            return frames.length
        })
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const flushFrame = () =>
        act(() => {
            const pending = frames
            frames = []
            for (const cb of pending) cb(0)
        })

    it('holds rapid updates until the next frame', () => {
        const { result, rerender } = renderHook(({ value }) => useFrameSyncedValue(value, 'tab-a'), { initialProps: { value: 'one' } })
        rerender({ value: 'two' })
        rerender({ value: 'three' })
        expect(result.current).toBe('one')
        flushFrame()
        expect(result.current).toBe('three')
    })

    it('returns the new value straight away when the reset key changes', () => {
        const { result, rerender } = renderHook(({ value, tab }) => useFrameSyncedValue(value, tab), {
            initialProps: { value: 'doc a', tab: 'a.md' },
        })
        rerender({ value: 'doc b', tab: 'b.md' })
        expect(result.current).toBe('doc b')
        flushFrame()
        expect(result.current).toBe('doc b')

        rerender({ value: 'doc b edited', tab: 'b.md' })
        expect(result.current).toBe('doc b')
        flushFrame()
        expect(result.current).toBe('doc b edited')
    })

    describe('with a delay', () => {
        beforeEach(() => {
            vi.useFakeTimers()
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        it('waits until the value has stopped changing for that long', () => {
            const { result, rerender } = renderHook(({ value }) => useFrameSyncedValue(value, 'tab-a', 200), { initialProps: { value: 'one' } })
            rerender({ value: 'two' })
            act(() => vi.advanceTimersByTime(150))
            rerender({ value: 'three' })
            act(() => vi.advanceTimersByTime(150))
            flushFrame()
            expect(result.current).toBe('one')

            act(() => vi.advanceTimersByTime(50))
            expect(result.current).toBe('three')
        })

        it('still shows a new tab’s value straight away', () => {
            const { result, rerender } = renderHook(({ value, tab }) => useFrameSyncedValue(value, tab, 200), {
                initialProps: { value: 'doc a', tab: 'a.md' },
            })
            rerender({ value: 'doc b', tab: 'b.md' })
            expect(result.current).toBe('doc b')
        })
    })
})
