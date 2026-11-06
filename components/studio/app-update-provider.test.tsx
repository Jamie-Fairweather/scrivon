import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentSave, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { AppUpdateProvider, useAppUpdate } from './app-update-provider'

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => undefined) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentSave: vi.fn(),
    useWorkspaceCoordinator: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))
vi.mock('@/lib/updater/release-notes', () => ({ fetchReleaseNotes: vi.fn(async () => null) }))
vi.mock('@/lib/updater/update-toast', () => ({ showUpdateAvailableToast: vi.fn() }))

const flushAllSaves = vi.fn<() => Promise<boolean>>()
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
    flushAllSaves.mockResolvedValue(true)
    persistWorkspaceTabSession.mockResolvedValue(undefined)
    const coordinator = createWorkspaceCoordinatorRefs()
    coordinator.persistWorkspaceTabSession.current = persistWorkspaceTabSession
    vi.mocked(useWorkspaceCoordinator).mockReturnValue(coordinator)
    vi.mocked(useDocumentSave).mockReturnValue({ flushAllSaves } as unknown as ReturnType<typeof useDocumentSave>)
    vi.mocked(invoke).mockResolvedValue(undefined)
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
        expect(result.current.saveFailed).toBe(true)
        expect(result.current.installing).toBe(false)

        await act(() => result.current.installUpdate({ ignoreSaveErrors: true }))

        expect(flushAllSaves).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith('install_app_update')
        expect(result.current.saveFailed).toBe(false)
    })

    it('treats a save that throws as a failed save', async () => {
        flushAllSaves.mockRejectedValue(new Error('disk gone'))

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(invoke).not.toHaveBeenCalledWith('install_app_update')
        expect(result.current.saveFailed).toBe(true)
    })

    it('tells the user when the install fails and lets them try again', async () => {
        vi.mocked(invoke).mockRejectedValue('Download failed')

        const { result } = renderHook(() => useAppUpdate(), { wrapper })
        await act(() => result.current.installUpdate())

        expect(notifyError).toHaveBeenCalledWith("Couldn't install the update", 'Download failed')
        expect(relaunch).not.toHaveBeenCalled()
        expect(result.current.installing).toBe(false)
    })

    it('shows the save warning in the update dialog and installs on "Install anyway"', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'check_for_app_update' ? { version: '9.9.9', notes: null } : undefined))
        flushAllSaves.mockResolvedValue(false)

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
        await user.click(await screen.findByRole('button', { name: 'Install and restart' }))

        expect(await screen.findByText("Some open files couldn't be saved")).toBeInTheDocument()
        expect(invoke).not.toHaveBeenCalledWith('install_app_update')

        await user.click(screen.getByRole('button', { name: 'Install anyway' }))

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('install_app_update'))
    })
})
