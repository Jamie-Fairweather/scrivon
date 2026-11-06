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
})
