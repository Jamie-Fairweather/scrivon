import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPresentFullscreen, type FullscreenWindow } from './present-fullscreen'

const tauri = vi.hoisted(() => ({ isTauri: false, window: null as FullscreenWindow | null }))

vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => tauri.isTauri, isWindowsTauri: () => false }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauri.window }))

/** A window that remembers whether it is full screen, like Tauri's. */
function fakeWindow(fullscreen = false) {
    const state = { fullscreen }
    const win = {
        state,
        isFullscreen: vi.fn(async () => state.fullscreen),
        setFullscreen: vi.fn(async (next: boolean) => {
            state.fullscreen = next
        }),
    }
    return win
}

describe('createPresentFullscreen', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        tauri.isTauri = false
        tauri.window = null
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('goes full screen, and leaves it again', async () => {
        const win = fakeWindow()
        const fullscreen = createPresentFullscreen(() => win)

        await fullscreen.enter()
        expect(win.setFullscreen).toHaveBeenLastCalledWith(true)
        expect(win.state.fullscreen).toBe(true)

        await fullscreen.leave()
        expect(win.setFullscreen).toHaveBeenLastCalledWith(false)
        expect(win.state.fullscreen).toBe(false)
    })

    it('leaves full screen only once, however many ways out are taken', async () => {
        const win = fakeWindow()
        const fullscreen = createPresentFullscreen(() => win)

        await fullscreen.enter()
        await Promise.all([fullscreen.leave(), fullscreen.leave()])
        await fullscreen.leave()

        expect(win.setFullscreen.mock.calls).toEqual([[true], [false]])
    })

    it('leaves a window alone that was already full screen', async () => {
        const win = fakeWindow(true)
        const fullscreen = createPresentFullscreen(() => win)

        await fullscreen.enter()
        await fullscreen.leave()

        expect(win.setFullscreen).not.toHaveBeenCalled()
        expect(win.state.fullscreen).toBe(true)
    })

    it('never leaves full screen when it was never entered', async () => {
        const win = fakeWindow()
        await createPresentFullscreen(() => win).leave()

        expect(win.setFullscreen).not.toHaveBeenCalled()
    })

    it('undoes going full screen when leaving starts before it has finished', async () => {
        const win = fakeWindow()
        let finishEntering = () => {}
        win.setFullscreen.mockImplementationOnce(
            (next: boolean) =>
                new Promise<void>((resolve) => {
                    finishEntering = () => {
                        win.state.fullscreen = next
                        resolve()
                    }
                })
        )
        const fullscreen = createPresentFullscreen(() => win)

        void fullscreen.enter()
        const left = fullscreen.leave()
        await vi.waitFor(() => expect(win.setFullscreen).toHaveBeenCalledTimes(1))
        finishEntering()
        await left

        expect(win.setFullscreen.mock.calls).toEqual([[true], [false]])
        expect(win.state.fullscreen).toBe(false)
    })

    it('carries on in the window when going full screen fails, with nothing to undo', async () => {
        const win = fakeWindow()
        win.setFullscreen.mockRejectedValueOnce(new Error('not allowed'))
        const fullscreen = createPresentFullscreen(() => win)

        await expect(fullscreen.enter()).resolves.toBeUndefined()
        await fullscreen.leave()

        expect(win.setFullscreen.mock.calls).toEqual([[true]])
        expect(console.warn).toHaveBeenCalledWith("Couldn't make the window full screen for present mode", expect.any(Error))
    })

    it('still finishes when leaving full screen fails', async () => {
        const win = fakeWindow()
        const fullscreen = createPresentFullscreen(() => win)
        await fullscreen.enter()
        win.setFullscreen.mockRejectedValueOnce(new Error('gone'))

        await expect(fullscreen.leave()).resolves.toBeUndefined()
        expect(console.warn).toHaveBeenCalledWith("Couldn't leave full screen after present mode", expect.any(Error))
    })

    it('uses the app window in the desktop app, and does nothing outside it', async () => {
        const win = fakeWindow()
        tauri.window = win

        await createPresentFullscreen().enter()
        expect(win.setFullscreen).not.toHaveBeenCalled()

        tauri.isTauri = true
        await createPresentFullscreen().enter()
        expect(win.setFullscreen).toHaveBeenCalledWith(true)
    })
})
