import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '@/components/studio/settings/sections/appearance-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY, type AppSettings, type ThemeSetting } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

let store: Map<string, string>

function renderAppearance(theme: Partial<ThemeSetting>) {
    store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ theme }))
    render(
        <SettingsProvider>
            <AppearanceSettings />
        </SettingsProvider>
    )
}

function savedTheme(): ThemeSetting {
    return (JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { theme: ThemeSetting }).theme
}

function savedAppearance(): AppSettings['appearance'] {
    return (JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as AppSettings).appearance
}

function checkedIn(name: string) {
    const group = screen.getByRole('radiogroup', { name })
    return [...group.querySelectorAll('[role="radio"][aria-checked="true"]')].map((radio) => radio.textContent)
}

describe('AppearanceSettings theme picker', () => {
    beforeEach(() => {
        store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
        // Windows is in dark mode.
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('exposes the themes as one choice and announces the selected one', () => {
        renderAppearance({ id: 'scrivon-dark' })

        expect(screen.getByRole('switch', { name: 'Follow Windows' })).toHaveAttribute('aria-checked', 'false')
        expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'Dark themes' })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Scrivon Dark' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1)

        fireEvent.click(screen.getByRole('radio', { name: 'Scrivon Light' }))

        expect(screen.getByRole('radio', { name: 'Scrivon Light' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('radio', { name: 'Scrivon Dark' })).toHaveAttribute('aria-checked', 'false')
    })

    it('following Windows keeps the current theme for dark mode, and lets each mode have its own theme', async () => {
        renderAppearance({ id: 'nord' })

        fireEvent.click(screen.getByRole('switch', { name: 'Follow Windows' }))

        expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument()
        expect(checkedIn('When Windows is dark')).toEqual(['Nord'])
        expect(checkedIn('When Windows is light')).toEqual(['Scrivon Light'])

        fireEvent.click(screen.getByRole('radio', { name: 'GitHub Light' }))
        fireEvent.click(screen.getByRole('radio', { name: 'Dracula' }))

        expect(checkedIn('When Windows is dark')).toEqual(['Dracula'])
        expect(checkedIn('When Windows is light')).toEqual(['GitHub Light'])
        // Changes made in quick succession are saved a moment after the last one.
        await waitFor(() => expect(savedTheme()).toEqual({ id: 'system', light: 'github-light', dark: 'dracula' }))
    })

    describe('text size', () => {
        it('zooms the whole app from a list of steps', async () => {
            vi.mocked(isTauri).mockReturnValue(true)
            renderAppearance({ id: 'scrivon-dark' })
            const user = userEvent.setup()

            const zoom = screen.getByRole('combobox', { name: 'Zoom' })
            expect(zoom).toHaveTextContent('100%')
            await user.click(zoom)
            await user.click(await screen.findByRole('option', { name: '125%' }))

            await waitFor(() => expect(savedAppearance().zoom).toBe(1.25))
        })

        it('leaves zoom to the browser outside the desktop app', () => {
            renderAppearance({ id: 'scrivon-dark' })

            expect(screen.queryByRole('combobox', { name: 'Zoom' })).not.toBeInTheDocument()
            expect(screen.getByRole('textbox', { name: 'Preview text size' })).toBeInTheDocument()
        })

        it('makes the Markdown preview text bigger or smaller', async () => {
            renderAppearance({ id: 'scrivon-dark' })

            const size = screen.getByRole('textbox', { name: 'Preview text size' })
            expect(size).toHaveValue('14')
            fireEvent.change(size, { target: { value: '18' } })
            fireEvent.blur(size)

            await waitFor(() => expect(savedAppearance().previewFontSize).toBe(18))
        })
    })

    it('turning off Follow Windows keeps the theme on screen', () => {
        renderAppearance({ id: 'system', light: 'github-light', dark: 'dracula' })
        expect(screen.getByRole('switch', { name: 'Follow Windows' })).toHaveAttribute('aria-checked', 'true')

        fireEvent.click(screen.getByRole('switch', { name: 'Follow Windows' }))

        expect(screen.getByRole('radio', { name: 'Dracula' })).toHaveAttribute('aria-checked', 'true')
        expect(savedTheme().id).toBe('dracula')
    })
})
