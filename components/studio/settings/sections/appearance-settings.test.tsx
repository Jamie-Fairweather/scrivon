import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '@/components/studio/settings/sections/appearance-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY, type ThemeSetting } from '@/lib/settings/types'

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

    it('turning off Follow Windows keeps the theme on screen', () => {
        renderAppearance({ id: 'system', light: 'github-light', dark: 'dracula' })
        expect(screen.getByRole('switch', { name: 'Follow Windows' })).toHaveAttribute('aria-checked', 'true')

        fireEvent.click(screen.getByRole('switch', { name: 'Follow Windows' }))

        expect(screen.getByRole('radio', { name: 'Dracula' })).toHaveAttribute('aria-checked', 'true')
        expect(savedTheme().id).toBe('dracula')
    })
})
