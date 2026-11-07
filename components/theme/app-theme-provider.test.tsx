import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'
import type { AppThemeId } from '@/lib/theme/catalog'
import { resolveThemeTokensForId } from '@/lib/theme/resolve-theme-tokens'
import { AppThemeProvider } from './app-theme-provider'

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
    useAppSettings: () => ({ settings: { theme: { id: state.themeId } }, setThemeId: vi.fn() }),
}))

const bg = (id: string) => resolveThemeTokensForId(id as AppThemeId).bg

describe('AppThemeProvider in the desktop app', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete document.documentElement.dataset.appTheme
        state.themeId = 'scrivon-light'
        state.calls = []
        vi.mocked(isTauri).mockReturnValue(true)
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
