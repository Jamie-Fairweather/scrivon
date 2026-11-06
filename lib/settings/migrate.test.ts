import { describe, expect, it, vi } from 'vitest'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import {
    dualWriteLegacyAutosave,
    dualWriteLegacyLayout,
    dualWriteLegacyTheme,
    keybindOverrides,
    mergeStoredSettings,
    migrateLegacySettings,
} from '@/lib/settings/migrate'
import { STORAGE_AUTOSAVE, STORAGE_KEY_WIDTH, STORAGE_LAYOUT_EDITOR, STORAGE_LAYOUT_EXPLORER, STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

describe('migrateLegacySettings', () => {
    it('maps legacy localStorage keys into unified settings', () => {
        const read = (key: string) => {
            const values: Record<string, string> = {
                [STORAGE_MERMAID_THEME]: 'scrivon-light',
                [STORAGE_AUTOSAVE]: 'false',
                [STORAGE_LAYOUT_EXPLORER]: 'false',
                [STORAGE_LAYOUT_EDITOR]: 'true',
                [STORAGE_KEY_WIDTH]: '520',
            }
            return values[key] ?? null
        }

        const settings = migrateLegacySettings(read, false)
        expect(settings.theme.id).toBe('scrivon-light')
        expect(settings.autosave.enabled).toBe(false)
        expect(settings.layout.explorerOpen).toBe(false)
        expect(settings.layout.editorOpen).toBe(true)
        expect(settings.layout.editorWidth).toBe(520)
    })

    it('falls back to defaults for invalid legacy values', () => {
        const read = (key: string) => {
            const values: Record<string, string> = {
                [STORAGE_MERMAID_THEME]: 'not-a-theme',
                [STORAGE_KEY_WIDTH]: 'not-a-number',
            }
            return values[key] ?? null
        }

        const settings = migrateLegacySettings(read, false)
        expect(settings.theme.id).toBe(createDefaultSettings(false).theme.id)
        expect(settings.layout.editorWidth).toBe(createDefaultSettings(false).layout.editorWidth)
    })
})

describe('mergeStoredSettings', () => {
    it('merges partial stored blob with defaults', () => {
        const merged = mergeStoredSettings(
            {
                autosave: { enabled: false, delayMs: 900 },
                editor: { fontSize: 16 },
            },
            false
        )

        expect(merged.autosave.enabled).toBe(false)
        expect(merged.autosave.delayMs).toBe(900)
        expect(merged.editor.fontSize).toBe(16)
        expect(merged.editor.tabSize).toBe(createDefaultSettings(false).editor.tabSize)
        expect(merged.pdfExport).toEqual(createDefaultSettings(false).pdfExport)
    })

    it('is idempotent for fully valid stored settings', () => {
        const original = createDefaultSettings(false)
        const merged = mergeStoredSettings(original, false)
        expect(merged).toEqual(original)
    })

    it('returns defaults for non-object stored values', () => {
        expect(mergeStoredSettings(null, false)).toEqual(createDefaultSettings(false))
    })

    it('normalizes invalid editor and keybind values', () => {
        const merged = mergeStoredSettings(
            {
                editor: { wordWrap: 'invalid', lineNumbers: 'invalid' },
                keybinds: {
                    'document.save': [{ key: 's', ctrl: true, meta: true, alt: true }, { key: '' }, null],
                    'settings.open': 'not-an-array',
                },
            },
            false
        )

        expect(merged.editor.wordWrap).toBe('on')
        expect(merged.editor.lineNumbers).toBe('on')
        expect(merged.keybinds['document.save']).toEqual([{ key: 's', ctrl: true, meta: true, alt: true }])
        expect(merged.keybinds['settings.open']).toEqual(createDefaultSettings(false).keybinds['settings.open'])
    })

    it('drops stored shortcuts that would break typing or Tab', () => {
        const merged = mergeStoredSettings(
            {
                keybinds: {
                    'view.toggleEditor': [{ key: 'Tab' }],
                    'view.toggleExplorer': [{ key: 'e' }, { key: 'b', ctrl: true }],
                    'palette.open': [{ key: 'F1' }],
                },
            },
            false
        )

        expect(merged.keybinds['view.toggleEditor']).toEqual([])
        expect(merged.keybinds['view.toggleExplorer']).toEqual([{ key: 'b', ctrl: true }])
        expect(merged.keybinds['palette.open']).toEqual([{ key: 'F1' }])
    })

    it('lets a shortcut the user chose win over a default that uses the same chord', () => {
        // The user gave Ctrl+R to Toggle editor; Fit diagram (never changed) has Ctrl+R by default.
        const merged = mergeStoredSettings({ keybinds: { 'view.toggleEditor': [{ key: 'r', ctrl: true }] } }, false)

        expect(merged.keybinds['view.toggleEditor']).toEqual([{ key: 'r', ctrl: true }])
        expect(merged.keybinds['view.fitDiagram']).toEqual([])
        expect(merged.keybinds['document.save']).toEqual([{ key: 's', ctrl: true }])
    })

    it('reads entries of a whole stored keymap that match the defaults as unchanged', () => {
        const stored = createDefaultKeybinds(false)
        stored['view.toggleEditor'] = [{ key: 'k', ctrl: true, alt: true }]

        const merged = mergeStoredSettings({ keybinds: stored }, false)

        expect(merged.keybinds).toEqual({ ...createDefaultKeybinds(false), 'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }] })
        expect(keybindOverrides(merged.keybinds, createDefaultKeybinds(false))).toEqual({
            'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }],
        })
    })

    it('keeps the default when stored chords are unreadable or modifier-only', () => {
        const merged = mergeStoredSettings(
            {
                keybinds: {
                    'view.fitDiagram': [{ code: 'KeyR', mods: ['ctrl'] }],
                    'view.toggleEditor': [{ key: 'Control', ctrl: true }],
                },
            },
            false
        )

        expect(merged.keybinds['view.fitDiagram']).toEqual([{ key: 'r', ctrl: true }])
        expect(merged.keybinds['view.toggleEditor']).toEqual([{ key: 'e', ctrl: true }])
    })

    it('keeps a shortcut the user cleared unassigned', () => {
        const merged = mergeStoredSettings({ keybinds: { 'document.save': [] } }, false)

        expect(merged.keybinds['document.save']).toEqual([])
    })

    it('clamps numeric settings to allowed ranges', () => {
        const merged = mergeStoredSettings(
            {
                autosave: { enabled: true, delayMs: 9999 },
                editor: { fontSize: 100, tabSize: 20 },
                layout: { editorWidth: 9999 },
                workspace: { maxRecentFolders: 999 },
            },
            false
        )

        expect(merged.autosave.delayMs).toBe(5000)
        expect(merged.editor.fontSize).toBe(32)
        expect(merged.editor.tabSize).toBe(8)
        expect(merged.layout.editorWidth).toBe(2000)
        expect(merged.workspace.maxRecentFolders).toBe(50)
    })
})

describe('keybindOverrides', () => {
    it('keeps only the shortcuts that differ from the defaults, with [] for cleared ones', () => {
        const defaults = createDefaultKeybinds(false)
        const keybinds = { ...defaults, 'document.save': [], 'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }] }

        expect(keybindOverrides(defaults, defaults)).toEqual({})
        expect(keybindOverrides(keybinds, defaults)).toEqual({
            'document.save': [],
            'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }],
        })
    })
})

describe('dualWriteLegacy helpers', () => {
    it('ignore localStorage failures', () => {
        vi.stubGlobal('localStorage', {
            setItem: () => {
                throw new Error('blocked')
            },
        })

        expect(() => dualWriteLegacyTheme('scrivon-dark')).not.toThrow()
        expect(() =>
            dualWriteLegacyLayout({
                explorerOpen: true,
                editorOpen: false,
                editorWidth: 400,
                restorePanelsOnOpen: true,
            })
        ).not.toThrow()
        expect(() => dualWriteLegacyAutosave(true)).not.toThrow()

        vi.unstubAllGlobals()
    })
})
