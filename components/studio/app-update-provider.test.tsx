import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentSave, useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import type { DocumentTab } from '@/lib/workspace/types'
import { AppUpdateProvider, SAVE_BEFORE_INSTALL_TIMEOUT_MS, useAppUpdate } from './app-update-provider'

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.0.0') }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => undefined) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentSave: vi.fn(),
    useDocumentTabs: vi.fn(),
    useWorkspaceCoordinator: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))
vi.mock('@/lib/updater/release-notes', () => ({ fetchUpdateReleaseNotes: vi.fn(async () => null) }))
vi.mock('@/lib/updater/update-toast', () => ({ showUpdateAvailableToast: vi.fn(), dismissUpdateToast: vi.fn() }))

const flushAllSaves = vi.fn<() => Promise<boolean>>()
const persistWorkspaceTabSession = vi.fn<() => Promise<void>>()
let autosaveEnabled = true

function mockTabs(tabs: Partial<DocumentTab>[]) {
    vi.mocked(useDocumentTabs).mockReturnValue({ tabs } as unknown as ReturnType<typeof useDocumentTabs>)
}

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
    flushAllSaves.mockResolvedValue(true)
    persistWorkspaceTabSession.mockResolvedValue(undefined)
    autosaveEnabled = true
    mockTabs([])
    const coordinator = createWorkspaceCoordinatorRefs()
    coordinator.persistWorkspaceTabSession.current = persistWorkspaceTabSession
    coordinator.getAutosaveEnabled.current = () => autosaveEnabled
    vi.mocked(useWorkspaceCoordinator).mockReturnValue(coordinator)
    vi.mocked(useDocumentSave).mockReturnValue({ flushAllSaves } as unknown as ReturnType<typeof useDocumentSave>)
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getVersion).mockResolvedValue('1.0.0')
})

afterEach(() => {
    vi.useRealTimers()
})

describe('AppUpdateProvider installUpdate', () => {
    it('saves open files and the tab session before running the installer', async () => {
        const calls: string[] = []
        flushAllSaves.mockImplementation(async () => {
            calls.push('flushAllSaves')
            return true
        })
        persistWorkspaceTabSession.mockImplementation(async () => {
            calls.push('persistWorkspaceTabSession')
        })
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            calls.push(cmd)
        })
        vi.mocked(relaunch).mockImplementation(async () => {
            calls.push('relaunch')
        })

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(calls).toEqual(['flushAllSaves', 'persistWorkspaceTabSession', 'install_app_update', 'relaunch'])
    })

    it('does not install when an open file fails to save, until the user says install anyway', async () => {
        flushAllSaves.mockResolvedValue(false)

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
        expect(result.current.installBlocker).toEqual({ reason: 'save-failed' })
        expect(result.current.installing).toBe(false)

        await act(() => result.current.installUpdate({ unsaved: 'discard' }))

        expect(flushAllSaves).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith('install_app_update')
        expect(result.current.installBlocker).toBeNull()
    })

    it('treats a save that throws as a failed save', async () => {
        flushAllSaves.mockRejectedValue(new Error('disk gone'))

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
        expect(result.current.installBlocker).toEqual({ reason: 'save-failed' })
    })

    it('stops waiting for a save that hangs, so the dialog can be closed again', async () => {
        vi.useFakeTimers()
        flushAllSaves.mockReturnValue(new Promise<boolean>(() => {}))

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        let install: Promise<void> = Promise.resolve()
        act(() => {
            install = result.current.installUpdate()
        })
        expect(result.current.installing).toBe(true)

        await act(async () => {
            await vi.advanceTimersByTimeAsync(SAVE_BEFORE_INSTALL_TIMEOUT_MS)
            await install
        })

        expect(result.current.installing).toBe(false)
        expect(result.current.installBlocker).toEqual({ reason: 'save-failed' })
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
    })

    it('asks before saving edited files when autosave is off', async () => {
        autosaveEnabled = false
        mockTabs([
            { id: 'a', name: 'notes.md', isDirty: true },
            { id: 'b', name: 'flow.mmd', isDirty: false },
            { id: 'c', name: 'sample.mmd', isDirty: true, readOnly: true },
        ])

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(result.current.installBlocker).toEqual({ reason: 'unsaved', fileNames: ['notes.md'] })
        expect(result.current.installing).toBe(false)
        expect(flushAllSaves).not.toHaveBeenCalled()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')

        await act(() => result.current.installUpdate({ unsaved: 'save' }))

        expect(flushAllSaves).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith('install_app_update')
    })

    it("installs without writing edited files when the user picks Don't save", async () => {
        autosaveEnabled = false
        mockTabs([{ id: 'a', name: 'notes.md', isDirty: true }])

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate({ unsaved: 'discard' }))

        expect(flushAllSaves).not.toHaveBeenCalled()
        expect(invoke).toHaveBeenCalledWith('install_app_update')
    })

    it('installs straight away with autosave off when nothing is edited', async () => {
        autosaveEnabled = false
        mockTabs([{ id: 'a', name: 'notes.md', isDirty: false }])

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(result.current.installBlocker).toBeNull()
        expect(invoke).toHaveBeenCalledWith('install_app_update')
    })

    it('tells the user when the install fails and lets them try again', async () => {
        vi.mocked(invoke).mockRejectedValue('Download failed')

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(notifyError).toHaveBeenCalledWith("Couldn't install the update", 'Download failed')
        expect(relaunch).not.toHaveBeenCalled()
        expect(result.current.installing).toBe(false)
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

    it("asks in the update dialog about unsaved files with autosave off, and installs on Don't save", async () => {
        autosaveEnabled = false
        mockTabs([{ id: 'a', name: 'notes.md', isDirty: true }])
        const user = await openUpdateDialogInUi()

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        expect(await screen.findByText('Save changes before installing?')).toBeInTheDocument()
        expect(screen.getByText(/notes\.md/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save and install' })).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')

        await user.click(screen.getByRole('button', { name: "Don't save" }))

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_app_update'))
        expect(flushAllSaves).not.toHaveBeenCalled()
    })

    it('shows the save warning in the update dialog and installs on "Install anyway"', async () => {
        flushAllSaves.mockResolvedValue(false)
        const user = await openUpdateDialogInUi()

        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        expect(await screen.findByText("Some open files couldn't be saved")).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')

        await user.click(screen.getByRole('button', { name: 'Install anyway' }))

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_app_update'))
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
