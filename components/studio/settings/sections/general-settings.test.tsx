import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettings } from '@/components/studio/settings/sections/general-settings'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'
import { SETTINGS_STORAGE_KEY, type AppSettings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn(() => true) }))

describe('GeneralSettings', () => {
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
                <GeneralSettings />
            </SettingsProvider>
        )
    }

    it('shows git changes in the explorer unless the user turns it off, and back on', () => {
        renderSection()
        const toggle = screen.getByRole('switch', { name: 'Show git changes in the explorer' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)
        expect(toggle).not.toBeChecked()
        expect((JSON.parse(store.get(SETTINGS_STORAGE_KEY)!) as AppSettings).workspace.showGitChanges).toBe(false)

        fireEvent.click(toggle)
        expect(toggle).toBeChecked()
    })

    it('offers to update links when files move unless the user turns it off', () => {
        renderSection()
        const toggle = screen.getByRole('switch', { name: 'Offer to update links when files move' })
        expect(toggle).toBeChecked()

        fireEvent.click(toggle)
        expect(toggle).not.toBeChecked()
        expect((JSON.parse(store.get(SETTINGS_STORAGE_KEY)!) as AppSettings).workspace.offerLinkUpdates).toBe(false)
    })

    it('leaves git changes out in a browser, where there is no git to ask', () => {
        vi.mocked(isTauri).mockReturnValue(false)
        renderSection()

        expect(screen.queryByRole('switch', { name: 'Show git changes in the explorer' })).not.toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'Autosave' })).toBeInTheDocument()
    })
})
