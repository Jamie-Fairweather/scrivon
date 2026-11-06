import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '@/components/studio/settings/sections/appearance-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

describe('AppearanceSettings theme picker', () => {
    beforeEach(() => {
        // Saved explicitly: without a saved theme the default follows the OS light or dark setting.
        const store = new Map<string, string>([[SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: 'scrivon-dark' } })]])
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('exposes the themes as one choice and announces the selected one', () => {
        render(
            <SettingsProvider>
                <AppearanceSettings />
            </SettingsProvider>
        )

        expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'Dark themes' })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: 'Scrivon Dark' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1)

        fireEvent.click(screen.getByRole('radio', { name: 'Scrivon Light' }))

        expect(screen.getByRole('radio', { name: 'Scrivon Light' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('radio', { name: 'Scrivon Dark' })).toHaveAttribute('aria-checked', 'false')
    })
})
