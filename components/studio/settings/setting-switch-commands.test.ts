import { describe, expect, it, vi } from 'vitest'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { searchActions } from '@/components/studio/command-palette/search-actions'
import { buildSettingSwitchCommands } from '@/components/studio/settings/setting-switch-commands'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings } from '@/lib/settings/types'

/** Runs the command and returns the settings it would save. */
function runOn(settings: AppSettings, id: string): AppSettings {
    const updateSettings = vi.fn()
    const command = buildSettingSwitchCommands(settings, updateSettings).find((c) => c.id === id)
    void command!.run()
    const change = updateSettings.mock.calls[0]![0] as (current: AppSettings) => AppSettings
    return change(settings)
}

describe('buildSettingSwitchCommands', () => {
    it('shows each setting as on/off', () => {
        const settings = createDefaultSettings()
        settings.statusBar.visible = false
        settings.spellcheck.enabled = true
        settings.editor.scrollSync = false
        settings.editor.jumpFromPreview = true

        const shown = buildSettingSwitchCommands(settings, vi.fn()).map(({ id, label, checked }) => ({ id, label, checked }))
        expect(shown).toEqual([
            { id: 'toggle-status-bar', label: 'Status Bar', checked: false },
            { id: 'toggle-spellcheck', label: 'Spell Check', checked: true },
            { id: 'toggle-scroll-sync', label: 'Scroll Editor with Preview', checked: false },
            { id: 'toggle-jump-from-preview', label: 'Jump to Editor on Double-Click', checked: true },
        ])
    })

    it('flips each setting and leaves the rest alone', () => {
        const settings = createDefaultSettings()

        const statusBar = runOn(settings, 'toggle-status-bar')
        expect(statusBar.statusBar.visible).toBe(!settings.statusBar.visible)

        const spelling = runOn(settings, 'toggle-spellcheck')
        expect(spelling.spellcheck).toEqual({ ...settings.spellcheck, enabled: !settings.spellcheck.enabled })

        const scroll = runOn(settings, 'toggle-scroll-sync')
        expect(scroll.editor).toEqual({ ...settings.editor, scrollSync: !settings.editor.scrollSync })

        const jump = runOn(settings, 'toggle-jump-from-preview')
        expect(jump.editor).toEqual({ ...settings.editor, jumpFromPreview: !settings.editor.jumpFromPreview })
    })

    it('flips the setting as saved, not as it was when the list was built', () => {
        const built = createDefaultSettings()
        built.spellcheck.enabled = true
        const updateSettings = vi.fn()
        void buildSettingSwitchCommands(built, updateSettings)
            .find((c) => c.id === 'toggle-spellcheck')!
            .run()

        const saved = createDefaultSettings()
        saved.spellcheck.enabled = false
        const change = updateSettings.mock.calls[0]![0] as (current: AppSettings) => AppSettings
        expect(change(saved).spellcheck.enabled).toBe(true)
    })

    it.each([
        ['spell', 'toggle-spellcheck'],
        ['status bar', 'toggle-status-bar'],
        ['scroll', 'toggle-scroll-sync'],
        ['double click', 'toggle-jump-from-preview'],
    ])('is found in the palette by typing "%s"', (query, id) => {
        const items = buildSettingSwitchCommands(createDefaultSettings(), vi.fn()).map((command) => commandToPaletteItem(command))
        expect(searchActions(items, query)[0]?.value).toBe(`action:${id}`)
    })
})
