import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalErrorReporter } from '@/components/global-error-reporter'
import { notifyError } from '@/lib/notify'

vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))

function throwUncaught(error: unknown, message = error instanceof Error ? error.message : String(error)) {
    window.dispatchEvent(new ErrorEvent('error', { error, message }))
}

function rejectUnhandled(reason: unknown) {
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
}

beforeEach(() => {
    vi.mocked(notifyError).mockReset()
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('GlobalErrorReporter', () => {
    it('reports an error nothing caught, which logs it and shows a toast', () => {
        render(<GlobalErrorReporter />)
        const error = new TypeError("Cannot read properties of undefined (reading 'path')")

        throwUncaught(error)

        expect(notifyError).toHaveBeenCalledTimes(1)
        expect(notifyError).toHaveBeenCalledWith('Something went wrong', error, expect.objectContaining({ id: expect.any(String) }))
    })

    it('reports a promise rejection nothing handled', () => {
        render(<GlobalErrorReporter />)

        rejectUnhandled('failed to open file')

        expect(notifyError).toHaveBeenCalledWith('Something went wrong', 'failed to open file', expect.anything())
    })

    it('reports an error event without an error object by its message', () => {
        render(<GlobalErrorReporter />)

        window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught ReferenceError: x is not defined' }))

        expect(notifyError).toHaveBeenCalledWith('Something went wrong', 'Uncaught ReferenceError: x is not defined', expect.anything())
    })

    it("ignores the browser's harmless ResizeObserver notice", () => {
        render(<GlobalErrorReporter />)

        throwUncaught(undefined, 'ResizeObserver loop completed with undelivered notifications.')

        expect(notifyError).not.toHaveBeenCalled()
    })

    it('ignores work the editor cancelled on purpose', () => {
        render(<GlobalErrorReporter />)
        const canceled = Object.assign(new Error('Canceled'), { name: 'Canceled' })

        rejectUnhandled(canceled)

        expect(notifyError).not.toHaveBeenCalled()
    })

    it('reports an error that keeps repeating once, until it stops for a while', () => {
        render(<GlobalErrorReporter />)

        for (let i = 0; i < 50; i++) throwUncaught(new Error('boom on every mouse move'))
        expect(notifyError).toHaveBeenCalledTimes(1)

        throwUncaught(new Error('a different problem'))
        expect(notifyError).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(10_000)
        throwUncaught(new Error('a different problem'))
        expect(notifyError).toHaveBeenCalledTimes(3)
    })

    it('stops listening once removed', () => {
        const { unmount } = render(<GlobalErrorReporter />)
        unmount()

        throwUncaught(new Error('boom'))
        rejectUnhandled('boom')

        expect(notifyError).not.toHaveBeenCalled()
    })
})
