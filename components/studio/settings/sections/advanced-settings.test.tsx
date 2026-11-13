import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdvancedSettings } from '@/components/studio/settings/sections/advanced-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY, type AppSettings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn(() => true) }))

describe('AdvancedSettings', () => {
    let store: Map<string, string>

    beforeEach(() => {
        store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.mocked(isTauri).mockReturnValue(true)
    })

    function renderSection() {
        render(
            <SettingsProvider>
                <AdvancedSettings />
            </SettingsProvider>
        )
    }

    it('reopens the last folder on startup unless the user turns it off', () => {
        renderSection()
        const toggle = screen.getByRole('switch', { name: 'Reopen last folder on startup' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)

        expect(toggle).not.toBeChecked()
        const saved = JSON.parse(store.get(SETTINGS_STORAGE_KEY)!) as AppSettings
        expect(saved.workspace.reopenLastFolder).toBe(false)
    })

    it('leaves the folder option out of the browser build, which has no folders', () => {
        vi.mocked(isTauri).mockReturnValue(false)
        renderSection()

        expect(screen.queryByRole('switch', { name: 'Reopen last folder on startup' })).not.toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'Restore panel layout' })).toBeInTheDocument()
    })
})
