import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { loadSettings, saveSettings } from '@/lib/settings/storage'
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
