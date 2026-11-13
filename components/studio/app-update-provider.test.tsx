import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVersion } from '@tauri-apps/api/app'
import { Channel, invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useSharedUpdateCheck } from '@/components/studio/shared-update-check'
import { useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { dismissNotification, notifyError, notifyInfo, notifySuccess } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { AppUpdateProvider, useAppUpdate, type UpdateProgress } from './app-update-provider'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.0') }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => undefined) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceCoordinator: vi.fn(),
}))
vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    notifySuccess: vi.fn(),
    dismissNotification: vi.fn(),
}))
vi.mock('@/lib/updater/release-notes', () => ({ fetchUpdateReleaseNotes: vi.fn(async () => null), fetchReleaseList: vi.fn(async () => null) }))
vi.mock('@/lib/updater/update-toast', () => ({ showUpdateAvailableToast: vi.fn(), dismissUpdateToast: vi.fn() }))

const confirmCloseTabs = vi.fn<() => Promise<boolean>>()
const releaseAllTabs = vi.fn<() => Promise<void>>()
const backUpUnsavedTabs = vi.fn<() => void>()
const persistWorkspaceTabSession = vi.fn<() => Promise<void>>()
const flushPendingSettings = vi.fn<() => void>()
const closeSettings = vi.fn<() => void>()

/** How many times the installer was started. */
function installCalls(): number {
    return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'install_app_update').length
}

function mockSettings(checkOnLaunch: boolean) {
    vi.mocked(useAppSettings).mockReturnValue({
        settings: { updates: { checkOnLaunch } },
        flushPendingSettings,
        closeSettings,
    } as unknown as ReturnType<typeof useAppSettings>)
}

/** How many times the app was asked for an update. */
function checkCalls(): number {
    return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'check_for_app_update').length
}

/** Makes the update check answer with `result` (an update, null for none, or an Error to fail). */
function answerChecksWith(result: { version: string; notes: string | null } | null | Error) {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd !== 'check_for_app_update') return undefined
        if (result instanceof Error) throw result.message
        return result
    })
}

/** The toast id a check the user asked for uses. */
const CHECK_TOAST = 'app-update-check'

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
        flushPendingSettings.mockImplementationOnce(() => void calls.push('flushPendingSettings'))
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            calls.push(cmd)
        })
        vi.mocked(relaunch).mockImplementation(async () => {
            calls.push('relaunch')
        })

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        // releaseAllTabs drops the copies of edits that were saved or thrown away, so they aren't offered back.
        // A settings change still waiting to be written goes just before the installer ends the app.
        expect(calls).toEqual([
            'confirmCloseTabs',
            'releaseAllTabs',
            'persistWorkspaceTabSession',
            'flushPendingSettings',
            'install_app_update',
            'relaunch',
        ])
    })

    it('does not install when the user cancels a question about the open files, and Install works again', async () => {
        confirmCloseTabs.mockResolvedValueOnce(false)

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(releaseAllTabs).not.toHaveBeenCalled()
        expect(installCalls()).toBe(0)
        expect(result.current.installPhase).toBe('idle')

        await act(() => result.current.installUpdate())
        expect(invoke).toHaveBeenCalledWith('install_app_update', { onProgress: expect.any(Channel) })
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

        expect(result.current.installError).toBe('Download failed')
        expect(relaunch).not.toHaveBeenCalled()
        expect(result.current.installPhase).toBe('idle')
        expect(backUpUnsavedTabs).toHaveBeenCalledTimes(1)

        await act(() => result.current.installUpdate())
        expect(invoke).toHaveBeenCalledTimes(2)
        expect(relaunch).toHaveBeenCalledTimes(1)
        expect(result.current.installError).toBeNull()
    })

    it('shows a failed install in the update dialog, with Try again', async () => {
        const user = await openUpdateDialogInUi()
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'install_app_update') throw "The update couldn't be downloaded. Check your internet connection and try again."
        })

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent("Couldn't install the update")
        expect(alert).toHaveTextContent("The update couldn't be downloaded. Check your internet connection and try again.")
        expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()

        // Later, then back again: the old error has gone.
        await user.click(screen.getByRole('button', { name: 'Later' }))
        await user.click(await screen.findByRole('button', { name: 'open' }))
        expect(await screen.findByRole('button', { name: 'Install and restart' })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

        expect(await screen.findByRole('button', { name: /Saving files…/ })).toBeDisabled()
        expect(screen.getByText('Saving open files…')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
        expect(installCalls()).toBe(0)

        await act(async () => {
            finishSaving(true)
        })
        expect(await screen.findByRole('button', { name: /Downloading…/ })).toBeDisabled()
        await act(async () => {
            finishInstall()
        })
    })

    it('shows how far the download has got, then that it is installing, with no close button meanwhile', async () => {
        const user = await openUpdateDialogInUi()
        let progress!: Channel<UpdateProgress>
        vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
            if (cmd !== 'install_app_update') return Promise.resolve(undefined)
            progress = (args as { onProgress: Channel<UpdateProgress> }).onProgress
            return new Promise<undefined>(() => {})
        })
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))
        await waitFor(() => expect(installCalls()).toBe(1))
        expect(screen.getByText('Downloading…', { selector: 'p' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

        const total = 13_002_342
        act(() => progress.onmessage({ event: 'started', total }))
        expect(screen.getByText('Downloading 0.0 / 12.4 MB')).toBeInTheDocument()
        act(() => progress.onmessage({ event: 'progress', downloaded: 3_355_443, total }))
        expect(screen.getByText('Downloading 3.2 / 12.4 MB')).toBeInTheDocument()
        expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', expect.stringMatching(/^25\.8/))
        // A screen reader is told the step once, not each of the many changes of the byte count.
        const announced = () => [...document.querySelectorAll('[aria-live]')].map((region) => region.textContent)
        expect(announced()).toEqual(['Downloading the update'])
        expect(screen.getByText('Downloading 3.2 / 12.4 MB').closest('[aria-live]')).toBeNull()

        act(() => progress.onmessage({ event: 'installing' }))
        expect(screen.getByText('Installing…', { selector: 'p' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Installing…/ })).toBeDisabled()
        expect(announced()).toEqual(['Installing the update'])
    })

    it('shows the size downloaded so far when the server gives no total', async () => {
        const user = await openUpdateDialogInUi()
        let progress!: Channel<UpdateProgress>
        vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
            if (cmd !== 'install_app_update') return Promise.resolve(undefined)
            progress = (args as { onProgress: Channel<UpdateProgress> }).onProgress
            return new Promise<undefined>(() => {})
        })

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))
        await waitFor(() => expect(installCalls()).toBe(1))
        act(() => progress.onmessage({ event: 'progress', downloaded: 5 * 1024 * 1024, total: null }))

        expect(screen.getByText('Downloading 5.0 MB…')).toBeInTheDocument()
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('goes back to Install and restart when the user cancels a question about the open files', async () => {
        confirmCloseTabs.mockResolvedValueOnce(false)
        const user = await openUpdateDialogInUi()

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        await waitFor(() => expect(screen.getByRole('button', { name: 'Install and restart' })).toBeEnabled())
        expect(installCalls()).toBe(0)
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

describe('AppUpdateProvider checkForUpdates', () => {
    it('opens the update dialog when a new version is found, closing Settings first', async () => {
        answerChecksWith({ version: '9.9.9', notes: null })
        mockSettings(false)
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => result.current.checkForUpdates())

        expect(result.current.update?.version).toBe('9.9.9')
        expect(result.current.dialogOpen).toBe(true)
        expect(closeSettings).toHaveBeenCalled()
        // The dialog shows it, so no toast as well, and the Checking toast goes.
        expect(showUpdateAvailableToast).not.toHaveBeenCalled()
        expect(dismissNotification).toHaveBeenCalledWith(CHECK_TOAST)
    })

    it('says so when the app is up to date', async () => {
        answerChecksWith(null)
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => result.current.checkForUpdates())

        // "Checking…" first, then the answer in its place.
        expect(notifyInfo).toHaveBeenCalledWith('Checking for updates…', { id: CHECK_TOAST, timeout: 0 })
        expect(notifySuccess).toHaveBeenCalledWith("You're up to date", { id: CHECK_TOAST, description: 'Version 1.0.0 is the newest version.' })
        expect(result.current.dialogOpen).toBe(false)
    })

    it('says why it could not check', async () => {
        answerChecksWith(new Error("Couldn't reach the update server."))
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => result.current.checkForUpdates())

        expect(notifyError).toHaveBeenCalledWith("Couldn't check for updates", "Couldn't reach the update server.", { id: CHECK_TOAST })
    })

    it("tells an rc build it couldn't check when GitHub's release list can't be read", async () => {
        answerChecksWith(null)
        vi.mocked(getVersion).mockResolvedValue('1.6.0-rc.1')
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => result.current.checkForUpdates())

        // Only the stable channel could be asked, so a newer rc may be out there.
        expect(invoke).toHaveBeenCalledWith('check_for_app_update', { releaseTag: null })
        expect(notifyError).toHaveBeenCalledWith("Couldn't check for updates", "Couldn't get the newest pre-release from GitHub. Try again later.", {
            id: CHECK_TOAST,
        })
        expect(notifySuccess).not.toHaveBeenCalled()
    })

    it('still offers a stable update to an rc build that could not read the release list', async () => {
        answerChecksWith({ version: '1.6.0', notes: null })
        vi.mocked(getVersion).mockResolvedValue('1.6.0-rc.1')
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => result.current.checkForUpdates())

        expect(result.current.dialogOpen).toBe(true)
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('shares the check with Settings, which sits outside the studio, while it is open', async () => {
        answerChecksWith(null)
        const { result, unmount } = renderHook(() => ({ shared: useSharedUpdateCheck(), updates: useAppUpdate() }), { wrapper })

        expect(result.current.shared.check).toBe(result.current.updates.checkForUpdates)
        await act(() => result.current.shared.check!())
        expect(notifySuccess).toHaveBeenCalledWith("You're up to date", expect.anything())

        unmount()
        const { result: afterwards } = renderHook(() => useSharedUpdateCheck())
        expect(afterwards.current.check).toBeNull()
    })

    it('shows that it is checking, and a second request meanwhile waits for the same check', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        let answer!: (update: null) => void
        vi.mocked(invoke).mockImplementation((cmd: string) =>
            cmd === 'check_for_app_update' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(undefined)
        )
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        let first!: Promise<void>
        let second!: Promise<void>
        act(() => {
            first = result.current.checkForUpdates()
            second = result.current.checkForUpdates()
        })
        await waitFor(() => expect(checkCalls()).toBe(1))
        expect(result.current.checking).toBe(true)

        await act(async () => {
            answer(null)
            await Promise.all([first, second])
        })
        expect(result.current.checking).toBe(false)
        expect(checkCalls()).toBe(1)
    })
})

describe('AppUpdateProvider automatic checks', () => {
    const HOURS = 60 * 60 * 1000

    it('does not show a check the user did not ask for', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        let answer!: (update: null) => void
        vi.mocked(invoke).mockImplementation((cmd: string) =>
            cmd === 'check_for_app_update' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(undefined)
        )
        const { result } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => vi.advanceTimersByTimeAsync(4_000))
        expect(checkCalls()).toBe(1)
        expect(result.current.checking).toBe(false)

        // Asking now joins the running check, and shows it.
        let manual!: Promise<void>
        act(() => {
            manual = result.current.checkForUpdates()
        })
        expect(result.current.checking).toBe(true)
        await act(async () => {
            answer(null)
            await manual
        })
        expect(checkCalls()).toBe(1)
        expect(result.current.checking).toBe(false)
        expect(notifySuccess).toHaveBeenCalledWith("You're up to date", expect.anything())
    })

    it('keeps quiet when an rc build could not read the release list', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        answerChecksWith(null)
        vi.mocked(getVersion).mockResolvedValue('1.6.0-rc.1')
        renderHook(() => useAppUpdate(), { wrapper })

        await act(() => vi.advanceTimersByTimeAsync(4_000))

        expect(checkCalls()).toBe(1)
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('checks soon after launch, then again every 6 hours while automatic checks are on', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        answerChecksWith(null)
        const { rerender } = renderHook(() => useAppUpdate(), { wrapper })

        await act(() => vi.advanceTimersByTimeAsync(4_000))
        expect(checkCalls()).toBe(1)
        await act(() => vi.advanceTimersByTimeAsync(6 * HOURS))
        expect(checkCalls()).toBe(2)

        mockSettings(false)
        rerender()
        await act(() => vi.advanceTimersByTimeAsync(12 * HOURS))
        expect(checkCalls()).toBe(2)
        // Nothing to say about an automatic check that found nothing.
        expect(notifyInfo).not.toHaveBeenCalled()
        expect(notifySuccess).not.toHaveBeenCalled()
    })

    it('shows the toast once for each new version, not on every check', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        answerChecksWith({ version: '9.9.9', notes: null })
        renderHook(() => useAppUpdate(), { wrapper })

        await act(() => vi.advanceTimersByTimeAsync(4_000 + 6 * HOURS))
        expect(checkCalls()).toBe(2)
        expect(showUpdateAvailableToast).toHaveBeenCalledTimes(1)

        answerChecksWith({ version: '10.0.0', notes: null })
        await act(() => vi.advanceTimersByTimeAsync(6 * HOURS))
        expect(vi.mocked(showUpdateAvailableToast).mock.calls.map(([version]) => version)).toEqual(['9.9.9', '10.0.0'])
    })

    it('keeps quiet when an automatic check fails', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        answerChecksWith(new Error('offline'))
        renderHook(() => useAppUpdate(), { wrapper })

        await act(() => vi.advanceTimersByTimeAsync(4_000))

        expect(checkCalls()).toBe(1)
        expect(notifyError).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith('Update check failed:', 'offline')
        warn.mockRestore()
    })
})
