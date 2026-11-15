import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { isWindowsTauri } from '@/lib/tauri/platform'
import { WindowTitlebarControls } from './window-titlebar-controls'

const calls = vi.hoisted(() => [] as string[])
const isMaximized = vi.hoisted(() => vi.fn(async () => false))
const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>())

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        isMaximized,
        onResized: async () => () => {},
        close: async () => void calls.push('close'),
        toggleMaximize: async () => void calls.push('toggleMaximize'),
        listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
            listeners.set(event, handler)
            return () => listeners.delete(event)
        },
    }),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useFlushPendingSettings: () => () => void calls.push('flushPendingSettings'),
}))

beforeEach(() => {
    calls.length = 0
    listeners.clear()
    vi.mocked(invoke).mockClear()
})

describe('WindowTitlebarControls', () => {
    it('writes a settings change that is still waiting before it closes the window', async () => {
        render(<WindowTitlebarControls />)
        await waitFor(() => expect(isMaximized).toHaveBeenCalled())

        await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))

        expect(calls).toEqual(['flushPendingSettings', 'close'])
    })

    it("the page's own button still toggles maximise", async () => {
        render(<WindowTitlebarControls />)
        await waitFor(() => expect(isMaximized).toHaveBeenCalled())

        await userEvent.setup().click(screen.getByRole('button', { name: 'Maximize' }))

        expect(calls).toEqual(['toggleMaximize'])
    })
})

describe('WindowTitlebarControls: Snap Layouts on Windows 11', () => {
    // Where the maximise button is on the page, in CSS pixels.
    let buttonRect = { left: 100, top: 0, right: 146, bottom: 32 }
    let scaleChanged: (() => void) | undefined

    function areaCalls() {
        return vi
            .mocked(invoke)
            .mock.calls.filter(([command]) => command === 'set_maximize_button_area')
            .map(([, args]) => args)
    }

    beforeEach(() => {
        buttonRect = { left: 100, top: 0, right: 146, bottom: 32 }
        scaleChanged = undefined
        vi.mocked(isWindowsTauri).mockReturnValue(true)
        vi.stubGlobal('devicePixelRatio', 1.5)
        vi.stubGlobal('matchMedia', (query: string) => ({
            media: query,
            matches: true,
            addEventListener: (_type: string, listener: () => void) => {
                scaleChanged = listener
            },
            removeEventListener: () => {},
        }))
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const { left, top, right, bottom } =
                this.getAttribute('aria-label') === 'Maximize' ? buttonRect : { left: 0, top: 0, right: 0, bottom: 0 }
            return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect
        })
    })

    afterEach(() => {
        vi.mocked(isWindowsTauri).mockReturnValue(false)
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('tells the app where the maximise button is, in screen pixels', async () => {
        render(<WindowTitlebarControls />)

        // 1.5 × the CSS pixels: Windows scaling at 150%, or zoom.
        await waitFor(() => expect(areaCalls()).toEqual([{ area: { x: 150, y: 0, width: 69, height: 48 } }]))
    })

    it('tells it again when the window is resized or the scaling changes', async () => {
        render(<WindowTitlebarControls />)
        await waitFor(() => expect(areaCalls()).toHaveLength(1))

        buttonRect = { left: 300, top: 0, right: 346, bottom: 32 }
        act(() => void window.dispatchEvent(new Event('resize')))
        expect(areaCalls().at(-1)).toEqual({ area: { x: 450, y: 0, width: 69, height: 48 } })

        // Moved to a screen at 200%.
        vi.stubGlobal('devicePixelRatio', 2)
        act(() => scaleChanged?.())
        expect(areaCalls().at(-1)).toEqual({ area: { x: 600, y: 0, width: 92, height: 64 } })

        // Nothing moved: no need to tell it again.
        const count = areaCalls().length
        act(() => void window.dispatchEvent(new Event('resize')))
        expect(areaCalls()).toHaveLength(count)
    })

    it('takes the Snap Layouts area away when the controls go', async () => {
        const { unmount } = render(<WindowTitlebarControls />)
        await waitFor(() => expect(areaCalls()).toHaveLength(1))

        unmount()

        expect(areaCalls().at(-1)).toEqual({ area: null })
    })

    it('lights up the maximise button while the pointer is over it', async () => {
        render(<WindowTitlebarControls />)
        const maximize = screen.getByRole('button', { name: 'Maximize' })
        await waitFor(() => expect(listeners.has('maximize-button-hover')).toBe(true))

        act(() => listeners.get('maximize-button-hover')?.({ payload: true }))
        expect(maximize).toHaveAttribute('data-hovered')

        act(() => listeners.get('maximize-button-hover')?.({ payload: false }))
        expect(maximize).not.toHaveAttribute('data-hovered')
    })

    it('leaves the button alone outside the Windows app', async () => {
        vi.mocked(isWindowsTauri).mockReturnValue(false)
        render(<WindowTitlebarControls />)
        await waitFor(() => expect(isMaximized).toHaveBeenCalled())

        expect(areaCalls()).toEqual([])
        expect(listeners.size).toBe(0)
    })
})
