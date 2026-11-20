import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@/lib/tauri/platform'

/** The parts of Tauri's window that present mode uses. */
export type FullscreenWindow = {
    isFullscreen: () => Promise<boolean>
    setFullscreen: (fullscreen: boolean) => Promise<void>
}

export type PresentFullscreen = {
    /** Makes the window full screen, unless it already is. A failure is only logged: the slides still fill the window. */
    enter: () => Promise<void>
    /**
     * Puts the window back as it was before {@link enter}: only leaves full screen if `enter` turned it on. Safe to
     * call any number of times, and before `enter` has finished. Resolves once the window has left full screen.
     */
    leave: () => Promise<void>
}

function currentWindow(): FullscreenWindow | null {
    return isTauri() ? getCurrentWindow() : null
}

/**
 * Full screen for present mode. The calls run one after another, so leaving while going full screen is still under
 * way waits for it and then undoes it. Windows puts the window back where it was, maximised or not, when it leaves
 * full screen. Outside the desktop app it does nothing.
 */
export function createPresentFullscreen(getWindow: () => FullscreenWindow | null = currentWindow): PresentFullscreen {
    let turnedOn = false
    let queue: Promise<void> = Promise.resolve()

    const run = (step: () => Promise<void>, failure: string): Promise<void> => {
        queue = queue.then(step).catch((err: unknown) => console.warn(failure, err))
        return queue
    }

    return {
        enter: () =>
            run(async () => {
                const win = getWindow()
                if (!win || turnedOn || (await win.isFullscreen())) return
                await win.setFullscreen(true)
                turnedOn = true
            }, "Couldn't make the window full screen for present mode"),
        leave: () =>
            run(async () => {
                if (!turnedOn) return
                turnedOn = false
                await getWindow()?.setFullscreen(false)
            }, "Couldn't leave full screen after present mode"),
    }
}
