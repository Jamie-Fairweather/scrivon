import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { AppUpdateProvider, useAppUpdate } from './app-update-provider'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.0') }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => undefined) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceCoordinator: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))
vi.mock('@/lib/updater/release-notes', () => ({ fetchUpdateReleaseNotes: vi.fn(async () => null) }))
vi.mock('@/lib/updater/update-toast', () => ({ showUpdateAvailableToast: vi.fn(), dismissUpdateToast: vi.fn() }))

const confirmCloseTabs = vi.fn<() => Promise<boolean>>()
const releaseAllTabs = vi.fn<() => Promise<void>>()
const backUpUnsavedTabs = vi.fn<() => void>()
const persistWorkspaceTabSession = vi.fn<() => Promise<void>>()

function mockSettings(checkOnLaunch: boolean) {
    vi.mocked(useAppSettings).mockReturnValue({ settings: { updates: { checkOnLaunch } } } as unknown as ReturnType<typeof useAppSettings>)
}

function wrapper({ children }: { children: ReactNode }) {
    return <AppUpdateProvider>{children}</AppUpdateProvider>
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    mockSettings(true)
    confirmCloseTabs.mockResolvedValue(true)
    releaseAllTabs.mockResolvedValue(undefined)
    persistWorkspaceTabSession.mockResolvedValue(undefined)
    const coordinator = createWorkspaceCoordinatorRefs()
    coordinator.confirmCloseTabs.current = confirmCloseTabs
    coordinator.releaseAllTabs.current = releaseAllTabs
    coordinator.backUpUnsavedTabs.current = backUpUnsavedTabs
    coordinator.persistWorkspaceTabSession.current = persistWorkspaceTabSession
    vi.mocked(useWorkspaceCoordinator).mockReturnValue(coordinator)
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getVersion).mockResolvedValue('1.0.0')
})

afterEach(() => {
    vi.useRealTimers()
})

describe('AppUpdateProvider installUpdate', () => {
    it('deals with open files as closing the window does, then installs', async () => {
        const calls: string[] = []
        const record = (name: string) => async () => {
            calls.push(name)
            return name === 'confirmCloseTabs' ? true : undefined
        }
        confirmCloseTabs.mockImplementation(record('confirmCloseTabs') as () => Promise<boolean>)
        releaseAllTabs.mockImplementation(record('releaseAllTabs') as () => Promise<void>)
        persistWorkspaceTabSession.mockImplementation(record('persistWorkspaceTabSession') as () => Promise<void>)
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            calls.push(cmd)
        })
        vi.mocked(relaunch).mockImplementation(async () => {
            calls.push('relaunch')
        })

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        // releaseAllTabs drops the copies of edits that were saved or thrown away, so they aren't offered back.
        expect(calls).toEqual(['confirmCloseTabs', 'releaseAllTabs', 'persistWorkspaceTabSession', 'install_app_update', 'relaunch'])
    })

    it('does not install when the user cancels a question about the open files, and Install works again', async () => {
        confirmCloseTabs.mockResolvedValueOnce(false)

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(releaseAllTabs).not.toHaveBeenCalled()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
        expect(result.current.installPhase).toBe('idle')

        await act(() => result.current.installUpdate())
        expect(invoke).toHaveBeenCalledWith('install_app_update')
    })

    it('ignores a second press while the first is still saving', async () => {
        let finishSaving!: (ok: boolean) => void
        confirmCloseTabs.mockReturnValueOnce(new Promise((resolve) => (finishSaving = resolve)))

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        let first!: Promise<void>
        act(() => {
            first = result.current.installUpdate()
        })
        expect(result.current.installPhase).toBe('saving')
        await act(() => result.current.installUpdate())
        await act(async () => {
            finishSaving(true)
            await first
        })

        expect(confirmCloseTabs).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('tells the user when the install fails, gives unsaved edits their copies back, and lets them try again', async () => {
        vi.mocked(invoke).mockRejectedValueOnce('Download failed')

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(notifyError).toHaveBeenCalledWith("Couldn't install the update", 'Download failed')
        expect(relaunch).not.toHaveBeenCalled()
        expect(result.current.installPhase).toBe('idle')
        expect(backUpUnsavedTabs).toHaveBeenCalledTimes(1)

        await act(() => result.current.installUpdate())
        expect(invoke).toHaveBeenCalledTimes(2)
        expect(relaunch).toHaveBeenCalledTimes(1)
    })

    async function openUpdateDialogInUi() {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'check_for_app_update' ? { version: '9.9.9', notes: null } : undefined))

        function OpenDialog() {
            const { update, openUpdateDialog } = useAppUpdate()
            return update ? (
                <button type="button" onClick={openUpdateDialog}>
                    open
                </button>
            ) : null
        }

        render(
            <AppUpdateProvider>
                <OpenDialog />
            </AppUpdateProvider>
        )

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_000)
        })
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        await user.click(await screen.findByRole('button', { name: 'open' }))
        return user
    }

    it('says it is saving files while it does, and only then that it is installing', async () => {
        let finishSaving!: (ok: boolean) => void
        confirmCloseTabs.mockReturnValueOnce(new Promise((resolve) => (finishSaving = resolve)))
        const user = await openUpdateDialogInUi()
        let finishInstall!: () => void
        vi.mocked(invoke).mockImplementation((cmd: string) =>
            cmd === 'install_app_update'
                ? new Promise<undefined>((resolve) => (finishInstall = () => resolve(undefined)))
                : Promise.resolve(undefined)
        )

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        expect(await screen.findByRole('button', { name: 'Saving files…' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')

        await act(async () => {
            finishSaving(true)
        })
        expect(await screen.findByRole('button', { name: 'Installing…' })).toBeDisabled()
        await act(async () => {
            finishInstall()
        })
    })

    it('goes back to Install and restart when the user cancels a question about the open files', async () => {
        confirmCloseTabs.mockResolvedValueOnce(false)
        const user = await openUpdateDialogInUi()

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        await waitFor(() => expect(screen.getByRole('button', { name: 'Install and restart' })).toBeEnabled())
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
    })
})

describe('AppUpdateProvider release notes', () => {
    it('finishes loading release notes when the launch-check setting is turned off mid-fetch', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'check_for_app_update' ? { version: '9.9.9', notes: null } : undefined))
        let resolveNotes: (notes: string | null) => void = () => {}
        vi.mocked(fetchUpdateReleaseNotes).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveNotes = resolve
                })
        )

        const { result, rerender } = renderHook(() => useAppUpdate(), { wrapper })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_000)
        })
        expect(result.current.notesLoading).toBe(true)

        mockSettings(false)
        rerender()
        await act(async () => {
            resolveNotes('## Fixes')
        })

        expect(result.current.notesLoading).toBe(false)
        expect(result.current.update?.notes).toBe('## Fixes')
    })

    it('shows the manifest notes at once, then the notes for every version since the installed one', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(getVersion).mockResolvedValue('1.3.0')
        vi.mocked(invoke).mockImplementation(async (cmd: string) =>
            cmd === 'check_for_app_update' ? { version: '1.4.2', notes: '## [1.4.2]' } : undefined
        )
        let resolveNotes: (notes: string | null) => void = () => {}
        vi.mocked(fetchUpdateReleaseNotes).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveNotes = resolve
                })
        )

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_000)
        })

        expect(result.current.update?.notes).toBe('## [1.4.2]')
        expect(result.current.notesLoading).toBe(true)
        expect(fetchUpdateReleaseNotes).toHaveBeenCalledWith({ version: '1.4.2', notes: '## [1.4.2]' }, '1.3.0')

        const combined = '## [1.4.2]\n\n## [1.4.1]\n\n## [1.4.0]'
        await act(async () => {
            resolveNotes(combined)
        })

        expect(result.current.notesLoading).toBe(false)
        expect(result.current.update?.notes).toBe(combined)
    })

    it('still loads notes when the installed version cannot be read', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(getVersion).mockRejectedValue(new Error('no permission'))
        vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'check_for_app_update' ? { version: '1.4.2', notes: null } : undefined))
        vi.mocked(fetchUpdateReleaseNotes).mockResolvedValue('## [1.4.2]')

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_000)
        })

        expect(fetchUpdateReleaseNotes).toHaveBeenCalledWith({ version: '1.4.2', notes: null }, null)
        await waitFor(() => expect(result.current.update?.notes).toBe('## [1.4.2]'))
    })
})

describe('AppUpdateProvider update toast', () => {
    async function findUpdate() {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'check_for_app_update' ? { version: '9.9.9', notes: null } : undefined))
        const hook = renderHook(() => useAppUpdate(), { wrapper })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_000)
        })
        expect(showUpdateAvailableToast).toHaveBeenCalledWith('9.9.9', expect.any(Function))
        return hook
    }

    it('closes the update toast when the dialog is opened from the menu-bar button', async () => {
        const { result } = await findUpdate()
        expect(dismissUpdateToast).not.toHaveBeenCalled()

        act(() => result.current.openUpdateDialog())

        expect(result.current.dialogOpen).toBe(true)
        expect(dismissUpdateToast).toHaveBeenCalled()
    })

    it("closes the update toast when the toast's own View button opens the dialog", async () => {
        const { result } = await findUpdate()
        const onView = vi.mocked(showUpdateAvailableToast).mock.calls[0]![1]

        act(() => onView())

        expect(result.current.dialogOpen).toBe(true)
        expect(dismissUpdateToast).toHaveBeenCalled()
    })
})
