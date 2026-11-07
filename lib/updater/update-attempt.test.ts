import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const openUrl = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))
const notifyError = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())
const notifyWarning = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))
vi.mock('@/lib/notify', () => ({ notifyError, notifySuccess, notifyWarning }))

import { RELEASES_URL, reportLastUpdateAttempt } from '@/lib/updater/update-attempt'

describe('reportLastUpdateAttempt', () => {
    beforeEach(() => {
        invoke.mockReset()
        openUrl.mockReset()
        isTauri.mockReturnValue(true)
        notifyError.mockReset()
        notifySuccess.mockReset()
        notifyWarning.mockReset()
    })

    it('warns when the last update never installed, with a link to download it', async () => {
        invoke.mockResolvedValueOnce({ version: '1.5.0', installed: false })

        await reportLastUpdateAttempt()

        expect(invoke).toHaveBeenCalledWith('take_update_attempt')
        expect(notifySuccess).not.toHaveBeenCalled()
        expect(notifyWarning).toHaveBeenCalledTimes(1)
        const [title, options] = notifyWarning.mock.calls[0]
        expect(title).toBe("The update to version 1.5.0 didn't install")
        expect(options.description).toMatch(/permission/)
        expect(options.timeout).toBe(0)
        expect(options.action.label).toBe('Download')

        openUrl.mockResolvedValueOnce(undefined)
        options.action.onClick()
        await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(RELEASES_URL))
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('says so when the releases page could not be opened in the browser', async () => {
        invoke.mockResolvedValueOnce({ version: '1.5.0', installed: false })
        await reportLastUpdateAttempt()
        const error = new Error('No browser is set up.')
        openUrl.mockRejectedValueOnce(error)

        notifyWarning.mock.calls[0]![1].action.onClick()

        await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't open the releases page", error))
    })

    it('confirms an update that installed', async () => {
        invoke.mockResolvedValueOnce({ version: '1.5.0', installed: true })

        await reportLastUpdateAttempt()

        expect(notifySuccess).toHaveBeenCalledWith('Updated to version 1.5.0')
        expect(notifyWarning).not.toHaveBeenCalled()
    })

    it('says nothing when no update was attempted', async () => {
        invoke.mockResolvedValueOnce(null)

        await reportLastUpdateAttempt()

        expect(notifySuccess).not.toHaveBeenCalled()
        expect(notifyWarning).not.toHaveBeenCalled()
    })

    it('does nothing outside the desktop app or when the check fails', async () => {
        isTauri.mockReturnValue(false)
        await reportLastUpdateAttempt()
        expect(invoke).not.toHaveBeenCalled()

        isTauri.mockReturnValue(true)
        invoke.mockRejectedValueOnce(new Error('no such command'))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(reportLastUpdateAttempt()).resolves.toBeUndefined()
        warn.mockRestore()
        expect(notifyWarning).not.toHaveBeenCalled()
    })
})
