import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { createPdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import { readSettingsExport, settingsExportText } from '@/lib/settings/settings-transfer'

vi.mock('@/lib/settings/chord-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settings/chord-utils')>()),
    isMacPlatform: () => false,
}))

function changedSettings() {
    const settings = createDefaultSettings(false)
    settings.theme.id = 'tokyo-night'
    settings.editor.fontSize = 18
    settings.keybinds['view.toggleEditor'] = [{ key: 'k', ctrl: true, alt: true }]
    settings.pdfExport = createPdfExportProfile(settings.pdfExport, 'Company report')
    return settings
}

describe('settings export file', () => {
    it('reads back the settings it was made from', () => {
        const settings = changedSettings()

        expect(readSettingsExport(settingsExportText(settings))).toEqual(settings)
    })

    it('says what it is, and keeps only the shortcuts the user changed', () => {
        const file = JSON.parse(settingsExportText(changedSettings())) as {
            scrivon: string
            version: number
            settings: { schemaVersion: number; theme: unknown; keybinds: unknown }
        }

        expect(file.scrivon).toBe('settings')
        expect(file.version).toBe(1)
        expect(file.settings.schemaVersion).toBe(1)
        expect(file.settings.theme).toEqual({ id: 'tokyo-night' })
        expect(file.settings.keybinds).toEqual({ 'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }] })
    })

    it("also reads the copy in Scrivon's data folder (settings.json)", () => {
        const copy = { theme: { id: 'scrivon-light' }, editor: { fontSize: 20 }, schemaVersion: 1 }

        const settings = readSettingsExport(JSON.stringify(copy))

        expect(settings.theme.id).toBe('scrivon-light')
        expect(settings.editor.fontSize).toBe(20)
    })

    it('puts values out of range back in range', () => {
        const text = JSON.stringify({ scrivon: 'settings', version: 1, settings: { editor: { fontSize: 400 }, workspace: { maxRecentFolders: -3 } } })

        const settings = readSettingsExport(text)

        expect(settings.editor.fontSize).toBe(32)
        expect(settings.workspace.maxRecentFolders).toBe(1)
    })

    it('says why a file is refused', () => {
        const notSettings = "This file isn't a Scrivon settings file."
        expect(() => readSettingsExport('{not json')).toThrow(notSettings)
        expect(() => readSettingsExport('[]')).toThrow(notSettings)
        expect(() => readSettingsExport(JSON.stringify({ theme: { id: 'scrivon-light' } }))).toThrow(notSettings)
        expect(() => readSettingsExport(JSON.stringify({ scrivon: 'settings', settings: 'nope' }))).toThrow(notSettings)
        expect(() => readSettingsExport(JSON.stringify({ scrivon: 'export-profile', version: 1, profile: {} }))).toThrow(
            'This is an export profile. Import it in Settings, Document export.'
        )
    })
})
