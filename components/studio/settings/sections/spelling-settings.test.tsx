import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpellingSettings } from '@/components/studio/settings/sections/spelling-settings'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import type { AppSettings } from '@/lib/settings/types'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

/** The settings as the provider has them now. */
const latest: { current: AppSettings | null } = { current: null }

function SettingsSpy() {
    const { settings } = useAppSettings()
    useEffect(() => {
        latest.current = settings
    })
    return null
}

function renderSettings(spellcheck: Partial<AppSettings['spellcheck']>) {
    const store = new Map<string, string>([[SETTINGS_STORAGE_KEY, JSON.stringify({ spellcheck })]])
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: unknown) => store.set(key, String(value)),
    })
    return render(
        <SettingsProvider>
            <SpellingSettings />
            <SettingsSpy />
        </SettingsProvider>
    )
}

describe('SpellingSettings', () => {
    beforeEach(() => {
        latest.current = null
    })
    afterEach(() => vi.unstubAllGlobals())

    it('turns spell check off and on', () => {
        renderSettings({ enabled: true })
        const toggle = screen.getByRole('switch', { name: /check spelling/i })
        expect(toggle).toBeChecked()
        fireEvent.click(toggle)
        expect(latest.current!.spellcheck.enabled).toBe(false)
    })

    it('shows the chosen dictionary language', () => {
        renderSettings({ language: 'en-GB' })
        expect(screen.getByRole('combobox', { name: 'Spelling language' })).toHaveTextContent('English (UK)')
    })

    it('lists the user’s words in order and removes one', () => {
        renderSettings({ words: ['Tauri', 'Scrivon'] })
        const list = screen.getByRole('list', { name: 'Your dictionary' })
        expect(
            within(list)
                .getAllByRole('listitem')
                .map((item) => item.textContent)
        ).toEqual(['Scrivon', 'Tauri'])

        fireEvent.click(screen.getByRole('button', { name: 'Remove “Tauri”' }))
        expect(latest.current!.spellcheck.words).toEqual(['Scrivon'])
    })

    it('keeps keyboard focus in the list when a word is removed', () => {
        renderSettings({ words: ['Alpha', 'Beta', 'Gamma'] })
        const remove = (word: string) => fireEvent.click(screen.getByRole('button', { name: `Remove “${word}”` }))

        remove('Beta')
        expect(screen.getByRole('button', { name: 'Remove “Gamma”' })).toHaveFocus()
        remove('Gamma')
        expect(screen.getByRole('button', { name: 'Remove “Alpha”' })).toHaveFocus()
        remove('Alpha')
        expect(screen.getByText(/No words yet/)).toHaveFocus()
    })

    it('says how to add words while the dictionary is empty', () => {
        renderSettings({ words: [] })
        expect(screen.queryByRole('list', { name: 'Your dictionary' })).not.toBeInTheDocument()
        expect(screen.getByText(/Add to Dictionary/)).toBeInTheDocument()
    })
})
