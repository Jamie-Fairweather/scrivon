import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { createPdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import {
    loadSettings,
    loadSettingsWithRecovery,
    saveSettings,
    SETTINGS_BACKUP_KEY,
    SETTINGS_CORRUPT_KEY_PREFIX,
    SETTINGS_NEWER_COPY_KEY_PREFIX,
    SETTINGS_SCHEMA_VERSION,
} from '@/lib/settings/storage'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import { STORAGE_AUTOSAVE, STORAGE_KEY_WIDTH, STORAGE_LAYOUT_EDITOR, STORAGE_LAYOUT_EXPLORER, STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

describe('loadSettings', () => {
    it('returns defaults when window is unavailable', () => {
        expect(loadSettings()).toEqual(createDefaultSettings(false))
    })
})

describe('saveSettings', () => {
    it('no-ops when window is unavailable', () => {
        expect(() => saveSettings(createDefaultSettings(false))).not.toThrow()
    })
})

describe('loadSettings and saveSettings with localStorage', () => {
    const store = new Map<string, string>()

    beforeEach(() => {
        store.clear()
        vi.stubGlobal('window', {})
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => {
                store.set(key, value)
            },
        })
        vi.stubGlobal('navigator', { userAgent: 'Windows' })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('loads stored settings blob when present', () => {
        const settings = createDefaultSettings(false)
        settings.autosave.enabled = false
        store.set(SETTINGS_STORAGE_KEY, JSON.stringify(settings))

        expect(loadSettings().autosave.enabled).toBe(false)
    })

    it('migrates legacy keys and persists unified settings when blob is missing', () => {
        store.set(STORAGE_MERMAID_THEME, 'scrivon-light')
        store.set(STORAGE_AUTOSAVE, 'false')
        store.set(STORAGE_LAYOUT_EXPLORER, 'false')
        store.set(STORAGE_LAYOUT_EDITOR, 'true')
        store.set(STORAGE_KEY_WIDTH, '480')

        const loaded = loadSettings()

        expect(loaded.theme.id).toBe('scrivon-light')
        expect(store.has(SETTINGS_STORAGE_KEY)).toBe(true)
    })

    it('falls back to migration when stored blob is invalid json', () => {
        store.set(SETTINGS_STORAGE_KEY, '{not json')
        store.set(STORAGE_MERMAID_THEME, 'scrivon-dark')

        expect(loadSettings().theme.id).toBe('scrivon-dark')
    })

    it('keeps a copy of unreadable settings and restores the last clean load', () => {
        const settings = createDefaultSettings(false)
        settings.editor.fontSize = 18
        settings.updates.checkOnLaunch = false
        saveSettings(settings)
        expect(loadSettingsWithRecovery().recovery).toBeNull()

        // What the old updateSettings race could leave behind.
        store.set(SETTINGS_STORAGE_KEY, 'undefined')
        const loaded = loadSettingsWithRecovery()

        expect(loaded.recovery).toBe('backup')
        expect(loaded.settings.editor.fontSize).toBe(18)
        expect(loaded.settings.updates.checkOnLaunch).toBe(false)
        const corrupt = [...store.keys()].filter((key) => key.startsWith(SETTINGS_CORRUPT_KEY_PREFIX))
        expect(corrupt.map((key) => store.get(key))).toEqual(['undefined'])
        // The restored copy is saved, so the next launch loads cleanly.
        expect(loadSettingsWithRecovery()).toEqual({ settings: loaded.settings, recovery: null })
    })

    it('says settings were reset, and keeps the unreadable text, when there is no backup', () => {
        store.set(SETTINGS_STORAGE_KEY, '{"editor": {"fontSize": 2')
        store.set(STORAGE_MERMAID_THEME, 'scrivon-dark')

        const loaded = loadSettingsWithRecovery()

        expect(loaded.recovery).toBe('reset')
        expect(loaded.settings.theme.id).toBe('scrivon-dark')
        const corrupt = [...store.keys()].filter((key) => key.startsWith(SETTINGS_CORRUPT_KEY_PREFIX))
        expect(corrupt.map((key) => store.get(key))).toEqual(['{"editor": {"fontSize": 2'])
    })

    it('does not report a first launch as a recovery', () => {
        expect(loadSettingsWithRecovery().recovery).toBeNull()
        expect(store.has(SETTINGS_STORAGE_KEY)).toBe(true)
        expect(store.has(SETTINGS_BACKUP_KEY)).toBe(false)
    })

    it('dual-writes legacy keys on save', () => {
        const settings = createDefaultSettings(false)
        settings.theme.id = 'tokyo-night'
        settings.layout.explorerOpen = false
        settings.layout.editorOpen = true
        settings.layout.editorWidth = 360
        settings.autosave.enabled = false

        saveSettings(settings)

        expect(store.get(STORAGE_MERMAID_THEME)).toBe('tokyo-night')
        expect(store.get(STORAGE_LAYOUT_EXPLORER)).toBe('false')
        expect(store.get(STORAGE_LAYOUT_EDITOR)).toBe('true')
        expect(store.get(STORAGE_KEY_WIDTH)).toBe('360')
        expect(store.get(STORAGE_AUTOSAVE)).toBe('false')
        expect(store.get(SETTINGS_STORAGE_KEY)).toContain('tokyo-night')
    })

    it('saves only the shortcuts the user changed, so defaults stay up to date', () => {
        const settings = createDefaultSettings(false)
        settings.keybinds['view.toggleEditor'] = [{ key: 'k', ctrl: true, alt: true }]
        settings.keybinds['document.save'] = []

        saveSettings(settings)

        const stored = JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as { keybinds: Record<string, unknown> }
        expect(stored.keybinds).toEqual({ 'document.save': [], 'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }] })
        expect(loadSettings().keybinds).toEqual(settings.keybinds)
    })

    describe('settings saved by a newer version', () => {
        // What a future Scrivon might save: a new section, a new theme and page size, a new
        // profile field, and a shortcut for an action this version doesn't have.
        function newerSettings() {
            const settings = createDefaultSettings(false)
            const profile = { ...settings.pdfExport.profiles[0]!, name: 'Report', futureField: 'kept' }
            profile.page = { ...profile.page, size: 'a5' as 'a4' }
            return {
                ...settings,
                schemaVersion: 2,
                futureSection: { enabled: true },
                theme: { id: 'future-theme' },
                editor: { ...settings.editor, futureOption: true },
                pdfExport: { ...settings.pdfExport, profiles: [profile] },
                keybinds: { 'tabs.close': [{ key: 'w', ctrl: true }] },
            }
        }

        type Saved = {
            schemaVersion: number
            futureSection?: unknown
            theme: { id: string }
            layout: { editorWidth: number }
            editor: Record<string, unknown>
            pdfExport?: { profiles: { page: { size: string }; futureField?: string }[] }
            keybinds: Record<string, unknown>
        }

        function saved(): Saved {
            return JSON.parse(store.get(SETTINGS_STORAGE_KEY) ?? '{}') as Saved
        }

        it('keeps what this version cannot read through an unrelated change', () => {
            const text = JSON.stringify(newerSettings())
            store.set(SETTINGS_STORAGE_KEY, text)

            const loaded = loadSettings()
            expect(loaded.theme.id).toBe(createDefaultSettings(false).theme.id)
            expect(loaded.pdfExport.profiles[0]!.page.size).toBe('a4')

            saveSettings({ ...loaded, layout: { ...loaded.layout, editorWidth: 500 } })

            const after = saved()
            expect(after.layout.editorWidth).toBe(500)
            expect(after.futureSection).toEqual({ enabled: true })
            expect(after.theme.id).toBe('future-theme')
            expect(after.editor.futureOption).toBe(true)
            expect(after.pdfExport?.profiles[0]?.page.size).toBe('a5')
            expect(after.pdfExport?.profiles[0]?.futureField).toBe('kept')
            expect(after.keybinds['tabs.close']).toEqual([{ key: 'w', ctrl: true }])
            expect(after.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
            // The newer version's settings are also kept untouched.
            expect(store.get(`${SETTINGS_NEWER_COPY_KEY_PREFIX}2`)).toBe(text)
        })

        it('still saves a change the user makes to one of those values', () => {
            store.set(SETTINGS_STORAGE_KEY, JSON.stringify(newerSettings()))
            const loaded = loadSettings()

            saveSettings({ ...loaded, theme: { id: 'tokyo-night' } })
            expect(saved().theme.id).toBe('tokyo-night')

            // Changed back within the same session: saved as chosen, not as first read.
            saveSettings({ ...loaded, theme: { id: loaded.theme.id } })
            expect(saved().theme.id).toBe(loaded.theme.id)
        })

        it('drops a known shortcut the user resets to its default', () => {
            store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ keybinds: { 'document.save': [{ key: 's', ctrl: true, alt: true }] } }))
            const loaded = loadSettings()

            saveSettings({ ...loaded, keybinds: createDefaultSettings(false).keybinds })

            expect(saved().keybinds).toEqual({})
        })

        it('brings export profiles back after an older version saved without them', () => {
            const settings = createDefaultSettings(false)
            settings.pdfExport = createPdfExportProfile(settings.pdfExport, 'Company report')
            saveSettings(settings)

            // Scrivon 1.4.2 doesn't know about export profiles and saves settings without them.
            const older = saved()
            delete older.pdfExport
            store.set(SETTINGS_STORAGE_KEY, JSON.stringify(older))

            expect(loadSettings().pdfExport.profiles.map((profile) => profile.name)).toContain('Company report')
        })
    })

    it('refuses to overwrite stored settings with a missing value', () => {
        const settings = createDefaultSettings(false)
        settings.editor.fontSize = 20
        saveSettings(settings)

        saveSettings(undefined as unknown as typeof settings)

        expect(store.get(SETTINGS_STORAGE_KEY)).not.toBe('undefined')
        expect(loadSettings().editor.fontSize).toBe(20)
    })

    it('ignores localStorage failures', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('blocked')
            },
        })

        expect(() => saveSettings(createDefaultSettings(false))).not.toThrow()
        expect(loadSettings().theme.id).toBe(createDefaultSettings(false).theme.id)
    })
})
