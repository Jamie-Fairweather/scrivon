import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'
import type { AppThemeId } from '@/lib/theme/catalog'
import { resolveThemeTokensForId } from '@/lib/theme/resolve-theme-tokens'
import { AppThemeProvider, useAppTheme } from './app-theme-provider'

const state = vi.hoisted(() => ({ themeId: 'scrivon-light' as string, calls: [] as string[] }))

const appWindow = vi.hoisted(() => ({
    setBackgroundColor: vi.fn(async (color: string) => {
        state.calls.push(`background ${color}`)
    }),
    show: vi.fn(async () => {
        state.calls.push('show')
    }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => appWindow }))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { theme: { id: state.themeId, light: 'solarized-light', dark: 'dracula' } }, setThemeId: vi.fn() }),
}))

/** Stands in for Windows' light/dark setting, as the page sees it. */
function fakeWindowsTheme(dark: boolean) {
    const listeners = new Set<() => void>()
    const query = {
        get matches() {
            return dark
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList
    vi.spyOn(window, 'matchMedia').mockReturnValue(query)
    return {
        switchTo(nextDark: boolean) {
            dark = nextDark
            act(() => {
                for (const listener of listeners) listener()
            })
        },
    }
}

function ShownTheme() {
    return <span data-testid="shown">{useAppTheme().themeId}</span>
}

const bg = (id: string) => resolveThemeTokensForId(id as AppThemeId).bg

describe('AppThemeProvider in the desktop app', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete document.documentElement.dataset.appTheme
        state.themeId = 'scrivon-light'
        state.calls = []
        vi.mocked(isTauri).mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('in System mode, switches between the light and dark themes as Windows does', async () => {
        state.themeId = 'system'
        const windows = fakeWindowsTheme(false)

        render(
            <AppThemeProvider>
                <ShownTheme />
            </AppThemeProvider>
        )
        expect(screen.getByTestId('shown')).toHaveTextContent('solarized-light')
        expect(document.documentElement.dataset.appTheme).toBe('solarized-light')

        windows.switchTo(true)

        expect(screen.getByTestId('shown')).toHaveTextContent('dracula')
        expect(document.documentElement.dataset.appTheme).toBe('dracula')
        await waitFor(() => expect(appWindow.setBackgroundColor).toHaveBeenLastCalledWith(bg('dracula')))
        await waitFor(() => expect(appWindow.show).toHaveBeenCalledTimes(1))
    })

    it('keeps a fixed theme when Windows switches', async () => {
        state.themeId = 'nord'
        const windows = fakeWindowsTheme(false)

        render(
            <AppThemeProvider>
                <ShownTheme />
            </AppThemeProvider>
        )
        windows.switchTo(true)

        expect(screen.getByTestId('shown')).toHaveTextContent('nord')
        await waitFor(() => expect(appWindow.show).toHaveBeenCalledTimes(1))
    })

    it("colours the window with the theme's background before showing it, once", async () => {
        const { rerender } = render(<AppThemeProvider>page</AppThemeProvider>)

        await waitFor(() => expect(appWindow.show).toHaveBeenCalledTimes(1))
        expect(state.calls).toEqual([`background ${bg('scrivon-light')}`, 'show'])

        state.themeId = 'scrivon-dark'
        rerender(<AppThemeProvider>page</AppThemeProvider>)

        await waitFor(() => expect(appWindow.setBackgroundColor).toHaveBeenLastCalledWith(bg('scrivon-dark')))
        expect(appWindow.show).toHaveBeenCalledTimes(1)
        expect(bg('scrivon-dark')).not.toBe(bg('scrivon-light'))
    })

    it('still shows the window when its colour could not be set', async () => {
        appWindow.setBackgroundColor.mockRejectedValueOnce(new Error('not allowed'))

        render(<AppThemeProvider>page</AppThemeProvider>)

        await waitFor(() => expect(appWindow.show).toHaveBeenCalledTimes(1))
    })

    it('leaves the window alone in the browser', async () => {
        vi.mocked(isTauri).mockReturnValue(false)

        render(<AppThemeProvider>page</AppThemeProvider>)

        await new Promise((resolve) => setTimeout(resolve, 150))
        expect(appWindow.setBackgroundColor).not.toHaveBeenCalled()
        expect(appWindow.show).not.toHaveBeenCalled()
        // The page itself still gets the theme.
        expect(document.documentElement.dataset.appTheme).toBe('scrivon-light')
    })
})
