import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastManager = vi.hoisted(() => ({ add: vi.fn(() => 'toast-id'), close: vi.fn() }))
const logError = vi.hoisted(() => vi.fn())
const logWarning = vi.hoisted(() => vi.fn())

vi.mock('@/components/ui/toast', () => ({ toastManager }))
vi.mock('@/lib/diagnostics/app-log', () => ({ logError, logWarning }))

import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the log file', () => {
    it('gets every error the user is shown, with its cause', () => {
        const cause = new Error('Access is denied.')

        notifyError("Couldn't install the update", cause)

        expect(logError).toHaveBeenCalledWith("Couldn't install the update", cause)
    })

    it('gets the description when an error has no cause', () => {
        notifyError('Export failed', undefined, { description: 'The printer timed out.' })

        expect(logError).toHaveBeenCalledWith('Export failed', 'The printer timed out.')
    })

    it('gets warnings with their description', () => {
        notifyWarning('Recent folders were reset', { description: 'The list was damaged.' })

        expect(logWarning).toHaveBeenCalledWith('Recent folders were reset', 'The list was damaged.')
    })

    it("doesn't get successes", () => {
        notifySuccess('Saved')

        expect(logError).not.toHaveBeenCalled()
        expect(logWarning).not.toHaveBeenCalled()
    })
})
