import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, invokeMock, listenMock } = vi.hoisted(() => ({
    isTauriMock: vi.fn(),
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
}))

vi.mock('@/lib/tauri/platform', () => ({ isTauri: isTauriMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

import { onLaunchPaths, takeLaunchPaths } from './launch'

beforeEach(() => {
    vi.clearAllMocks()
})

describe('takeLaunchPaths', () => {
    it('has nothing to open outside the desktop app', async () => {
        isTauriMock.mockReturnValue(false)
        expect(await takeLaunchPaths()).toEqual([])
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('takes the files and folders waiting in the app', async () => {
        isTauriMock.mockReturnValue(true)
        invokeMock.mockResolvedValue([{ path: 'C:\\ws\\notes.md', isFolder: false }])

        expect(await takeLaunchPaths()).toEqual([{ path: 'C:\\ws\\notes.md', isFolder: false }])
        expect(invokeMock).toHaveBeenCalledWith('take_launch_paths')
    })
})

describe('onLaunchPaths', () => {
    it('never calls back outside the desktop app', async () => {
        isTauriMock.mockReturnValue(false)
        const stop = await onLaunchPaths(vi.fn())
        stop()
        expect(listenMock).not.toHaveBeenCalled()
    })

    it('calls back each time another launch hands over files', async () => {
        isTauriMock.mockReturnValue(true)
        const unlisten = vi.fn()
        listenMock.mockResolvedValue(unlisten)
        const handler = vi.fn()

        const stop = await onLaunchPaths(handler)
        const [event, listener] = listenMock.mock.calls[0]!
        listener({ event, id: 1, payload: null })

        expect(event).toBe('launch-paths')
        expect(handler).toHaveBeenCalledTimes(1)
        expect(stop).toBe(unlisten)
    })
})
