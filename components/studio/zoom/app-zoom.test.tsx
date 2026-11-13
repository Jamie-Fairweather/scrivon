import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { AppZoom } from '@/components/studio/zoom/app-zoom'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

const webview = vi.hoisted(() => ({ setZoom: vi.fn<(zoom: number) => Promise<void>>(async () => undefined) }))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => webview }))

let store: Map<string, string>

function savedZoom(): number | undefined {
    return (JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { appearance?: { zoom: number } }).appearance?.zoom
}

function renderAppZoom(zoom: number, children?: React.ReactNode) {
    store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ appearance: { zoom } }))
    return render(
        <SettingsProvider>
            <AppZoom />
            {children}
        </SettingsProvider>
    )
}

/** A Ctrl+wheel notch over `target`. Returns false when the app took it (the default was prevented). */
function ctrlWheel(target: Element, deltaY: number) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode: 0 })
    // happy-dom's WheelEvent has no modifier keys of its own.
    Object.defineProperty(event, 'ctrlKey', { value: true })
    return fireEvent(target, event)
}

describe('AppZoom in the desktop app', () => {
    beforeEach(() => {
        store = new Map()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
        vi.mocked(isTauri).mockReturnValue(true)
        webview.setZoom.mockClear()
    })

    afterEach(() => {
        vi.mocked(isTauri).mockReturnValue(false)
        vi.unstubAllGlobals()
    })

    it('opens at the zoom saved last time', async () => {
        renderAppZoom(1.25)

        await waitFor(() => expect(webview.setZoom).toHaveBeenLastCalledWith(1.25))
    })

    it('zooms in and out a step per Ctrl+wheel notch, and saves it', async () => {
        renderAppZoom(1)

        expect(ctrlWheel(document.body, -100)).toBe(false)
        await waitFor(() => expect(webview.setZoom).toHaveBeenLastCalledWith(1.1))
        expect(savedZoom()).toBe(1.1)

        ctrlWheel(document.body, 100)
        ctrlWheel(document.body, 100)
        await waitFor(() => expect(webview.setZoom).toHaveBeenLastCalledWith(0.9))
    })

    it('stops at 200%', async () => {
        renderAppZoom(2)
        await waitFor(() => expect(webview.setZoom).toHaveBeenCalledTimes(1))

        expect(ctrlWheel(document.body, -100)).toBe(false)
        expect(savedZoom()).toBe(2)
        expect(webview.setZoom).toHaveBeenCalledTimes(1)
    })

    it("says so in the log when the window can't zoom", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        webview.setZoom.mockRejectedValueOnce(new Error('not allowed'))

        renderAppZoom(1.5)

        await waitFor(() => expect(warn).toHaveBeenCalledWith("Couldn't zoom the window", expect.any(Error)))
        warn.mockRestore()
    })

    it('leaves the plain wheel alone, so it still scrolls', () => {
        renderAppZoom(1)

        expect(fireEvent.wheel(document.body, { deltaY: -100 })).toBe(true)
        expect(savedZoom()).toBe(1)
    })

    it('leaves Ctrl+wheel over the diagram canvas to the canvas, which zooms the diagram', () => {
        const { getByTestId } = renderAppZoom(
            1,
            <div data-own-zoom>
                <span data-testid="diagram" />
            </div>
        )

        expect(ctrlWheel(getByTestId('diagram'), -100)).toBe(true)
        expect(savedZoom()).toBe(1)
    })

    it("zooms the app over the diagram's error message, which the canvas leaves alone", async () => {
        const { getByTestId } = renderAppZoom(
            1,
            <div data-own-zoom>
                <div data-canvas-no-gestures>
                    <pre data-testid="error" />
                </div>
            </div>
        )

        expect(ctrlWheel(getByTestId('error'), -100)).toBe(false)
        await waitFor(() => expect(savedZoom()).toBe(1.1))
    })
})

describe('AppZoom in a browser', () => {
    it('leaves zoom to the browser', () => {
        store = new Map()
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
        render(
            <SettingsProvider>
                <AppZoom />
            </SettingsProvider>
        )

        expect(ctrlWheel(document.body, -100)).toBe(true)
        expect(webview.setZoom).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })
})
