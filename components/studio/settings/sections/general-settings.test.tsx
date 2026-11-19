import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
    value: { autosave: { enabled: true, delayMs: 400 }, fileHistory: { enabled: true } },
    setFileHistoryEnabled: vi.fn(),
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({
        settings: settings.value,
        setAutosaveEnabled: vi.fn(),
        setAutosaveDelayMs: vi.fn(),
        setFileHistoryEnabled: settings.setFileHistoryEnabled,
    }),
}))
vi.mock('@/lib/tauri/file-history', () => ({ deleteAllFileHistory: vi.fn(async () => {}) }))
vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
}))

const { GeneralSettings } = await import('./general-settings')
const { deleteAllFileHistory } = await import('@/lib/tauri/file-history')
const { notifyError, notifySuccess } = await import('@/lib/notify')
const { isTauri } = await import('@/lib/tauri/platform')

/** Lets the confirm finish opening or closing. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(true)
    settings.value = { autosave: { enabled: true, delayMs: 400 }, fileHistory: { enabled: true } }
})

describe('GeneralSettings file history', () => {
    it('turns file history on and off', () => {
        render(<GeneralSettings />)
        const toggle = screen.getByRole('switch', { name: 'File history' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)

        expect(settings.setFileHistoryEnabled).toHaveBeenCalledWith(false)
    })

    it('deletes all file history only once the user confirms', async () => {
        render(<GeneralSettings />)

        fireEvent.click(screen.getByRole('button', { name: 'Delete All File History…' }))
        await settle()
        let confirm = screen.getByRole('alertdialog', { name: 'Delete all file history?' })
        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
        await settle()
        expect(deleteAllFileHistory).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Delete All File History…' }))
        await settle()
        confirm = screen.getByRole('alertdialog', { name: 'Delete all file history?' })
        fireEvent.click(within(confirm).getByRole('button', { name: 'Delete All' }))
        await settle()

        expect(deleteAllFileHistory).toHaveBeenCalledTimes(1)
        expect(notifySuccess).toHaveBeenCalledWith('File history deleted')
    })

    it('says when the history could not be deleted', async () => {
        vi.mocked(deleteAllFileHistory).mockRejectedValueOnce(new Error('in use'))
        render(<GeneralSettings />)

        fireEvent.click(screen.getByRole('button', { name: 'Delete All File History…' }))
        await settle()
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete All' }))
        await settle()

        expect(notifyError).toHaveBeenCalledWith("Couldn't delete the file history", expect.any(Error))
    })

    it('is only shown in the desktop app, which keeps the history', () => {
        vi.mocked(isTauri).mockReturnValue(false)
        render(<GeneralSettings />)

        expect(screen.queryByRole('switch', { name: 'File history' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Delete All File History…' })).not.toBeInTheDocument()
    })
})
