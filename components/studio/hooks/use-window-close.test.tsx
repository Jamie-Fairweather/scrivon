import { act, renderHook } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { PresentModeProvider, usePresentMode, type PresentMode } from '@/components/studio/present/present-mode-provider'
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

const flushPendingSettings = vi.hoisted(() => vi.fn())
vi.mock('@/components/studio/settings/settings-provider', () => ({ useFlushPendingSettings: () => flushPendingSettings }))

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
        vi.restoreAllMocks()
        vi.mocked(invoke).mockResolvedValue(undefined)
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

    it('tells the app it is handling the close before anything that can wait on the user', async () => {
        const order: string[] = []
        vi.mocked(invoke).mockImplementation(async (command) => {
            order.push(command)
        })
        state.coordinator.confirmCloseTabs.current = vi.fn(async () => {
            order.push('confirmCloseTabs')
            return false
        })
        renderHook(() => useWindowCloseHandler())

        await requestClose()

        expect(order).toEqual(['close_ack', 'confirmCloseTabs'])
    })

    it('writes a settings change that is still waiting, right after telling the app it is handling the close', async () => {
        const order: string[] = []
        vi.mocked(invoke).mockImplementation(async (command) => {
            order.push(command)
        })
        flushPendingSettings.mockImplementationOnce(() => void order.push('flushPendingSettings'))
        state.coordinator.confirmCloseTabs.current = vi.fn(async () => {
            order.push('confirmCloseTabs')
            return false
        })
        renderHook(() => useWindowCloseHandler())

        await requestClose()

        expect(order).toEqual(['close_ack', 'flushPendingSettings', 'confirmCloseTabs'])
    })

    it('still asks about unsaved changes when the app could not be told', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.mocked(invoke).mockRejectedValue(new Error('no app'))
        const confirmCloseTabs = vi.fn(async () => true)
        state.coordinator.confirmCloseTabs.current = confirmCloseTabs
        renderHook(() => useWindowCloseHandler())

        await expect(requestClose()).resolves.toEqual({ closed: true })
        expect(confirmCloseTabs).toHaveBeenCalledTimes(1)
    })

    it('removes the copies of unsaved text before the window goes, once closing is sure', async () => {
        const releaseAllTabs = vi.fn(async () => {})
        state.coordinator.releaseAllTabs.current = releaseAllTabs
        renderHook(() => useWindowCloseHandler())

        await expect(requestClose()).resolves.toEqual({ closed: true })
        expect(releaseAllTabs).toHaveBeenCalledTimes(1)
    })

    it('keeps the window open when the user cancels or saving failed', async () => {
        const releaseAllTabs = vi.fn(async () => {})
        state.coordinator.confirmCloseTabs.current = vi.fn(async () => false)
        state.coordinator.releaseAllTabs.current = releaseAllTabs
        renderHook(() => useWindowCloseHandler())

        await expect(requestClose()).resolves.toEqual({ closed: false })
        expect(releaseAllTabs).not.toHaveBeenCalled()
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

    describe('while presenting', () => {
        function renderPresenting() {
            const order: string[] = []
            let finishLeaving = () => {}
            const fullscreen = {
                enter: vi.fn(async () => {}),
                leave: vi.fn(
                    () =>
                        new Promise<void>((resolve) => {
                            finishLeaving = () => {
                                order.push('left full screen')
                                resolve()
                            }
                        })
                ),
            }
            const presentMode = { current: null as PresentMode | null }
            const wrapper = ({ children }: { children: ReactNode }) => <PresentModeProvider fullscreen={fullscreen}>{children}</PresentModeProvider>
            renderHook(
                () => {
                    presentMode.current = usePresentMode()
                    useWindowCloseHandler()
                },
                { wrapper }
            )
            act(() => presentMode.current!.present('C:\\ws\\talk.md'))
            return { order, fullscreen, presentMode, finishLeaving: () => finishLeaving() }
        }

        it('leaves present mode and full screen before asking about unsaved changes', async () => {
            const { order, presentMode, finishLeaving } = renderPresenting()
            state.coordinator.confirmCloseTabs.current = vi.fn(async () => {
                order.push('confirmCloseTabs')
                return true
            })

            let closing!: Promise<void>
            act(() => {
                closing = state.handler!({ preventDefault: () => {} })
            })
            expect(presentMode.current!.presentingTabId).toBeNull()
            await act(async () => {
                await Promise.resolve()
            })
            expect(order).toEqual([])

            await act(async () => {
                finishLeaving()
                await closing
            })
            expect(order).toEqual(['left full screen', 'confirmCloseTabs'])
        })

        it('stays out of present mode when the user cancels, with the window open', async () => {
            const { presentMode, fullscreen, finishLeaving } = renderPresenting()
            state.coordinator.confirmCloseTabs.current = vi.fn(async () => false)

            let prevented = false
            let closing!: Promise<void>
            act(() => {
                closing = state.handler!({ preventDefault: () => (prevented = true) })
            })
            await act(async () => {
                finishLeaving()
                await closing
            })

            expect(prevented).toBe(true)
            expect(presentMode.current!.presentingTabId).toBeNull()
            expect(fullscreen.leave).toHaveBeenCalled()
        })
    })
})
