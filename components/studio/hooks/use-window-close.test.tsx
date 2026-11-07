import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { useWindowCloseHandler } from './use-window-close'

type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>

const state = vi.hoisted(() => ({
    workspaceRoot: 'C:\\ws' as string | null,
    coordinator: null as unknown as ReturnType<typeof createWorkspaceCoordinatorRefs>,
    handler: null as CloseHandler | null,
    resolveListen: null as ((unlisten: () => void) => void) | null,
}))

const onCloseRequested = vi.hoisted(() =>
    vi.fn(
        (handler: CloseHandler) =>
            new Promise<() => void>((resolve) => {
                state.handler = handler
                state.resolveListen = resolve
            })
    )
)

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ onCloseRequested }),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: state.workspaceRoot }),
    useWorkspaceCoordinator: () => state.coordinator,
}))

/** Mirrors Tauri: the window is destroyed after the handler unless it called preventDefault. */
async function requestClose() {
    let prevented = false
    await act(async () => {
        await state.handler!({ preventDefault: () => (prevented = true) })
    })
    return { closed: !prevented }
}

describe('useWindowCloseHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(true)
        state.workspaceRoot = 'C:\\ws'
        state.coordinator = createWorkspaceCoordinatorRefs()
        state.handler = null
    })

    it('closes the window once every tab is saved or the user chose to close without saving', async () => {
        const confirmCloseTabs = vi.fn(async () => true)
        state.coordinator.confirmCloseTabs.current = confirmCloseTabs
        renderHook(() => useWindowCloseHandler())

        await expect(requestClose()).resolves.toEqual({ closed: true })
        expect(confirmCloseTabs).toHaveBeenCalledWith()
    })

    it('keeps the window open when the user cancels or saving failed', async () => {
        state.coordinator.confirmCloseTabs.current = vi.fn(async () => false)
        renderHook(() => useWindowCloseHandler())

        await expect(requestClose()).resolves.toEqual({ closed: false })
    })

    it('removes a listener that finishes registering after the hook is gone', async () => {
        const { unmount } = renderHook(() => useWindowCloseHandler())
        const unlisten = vi.fn()

        unmount()
        await act(async () => {
            state.resolveListen!(unlisten)
        })

        expect(unlisten).toHaveBeenCalledTimes(1)
    })

    it('removes the listener when the folder closes', async () => {
        const { rerender } = renderHook(() => useWindowCloseHandler())
        const unlisten = vi.fn()
        await act(async () => {
            state.resolveListen!(unlisten)
        })

        state.workspaceRoot = null
        rerender()

        expect(unlisten).toHaveBeenCalledTimes(1)
        expect(onCloseRequested).toHaveBeenCalledTimes(1)
    })
})
