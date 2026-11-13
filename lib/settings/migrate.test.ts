import { describe, expect, it, vi } from 'vitest'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import {
    dualWriteLegacyAutosave,
    dualWriteLegacyLayout,
    dualWriteLegacyTheme,
    keybindOverrides,
    keybindsFromOverrides,
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

    it('starts a new install in System mode, with Scrivon Light and Scrivon Dark', () => {
        expect(migrateLegacySettings(() => null, false).theme).toEqual({ id: 'system', light: 'scrivon-light', dark: 'scrivon-dark' })
        expect(createDefaultSettings(false).theme).toEqual({ id: 'system', light: 'scrivon-light', dark: 'scrivon-dark' })
    })

    it('keeps a theme saved by a version before unified settings as a fixed choice', () => {
        const read = (key: string) => (key === STORAGE_MERMAID_THEME ? 'dracula' : null)

        expect(migrateLegacySettings(read, false).theme).toEqual({ id: 'dracula', light: 'scrivon-light', dark: 'scrivon-dark' })
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

    it('keeps a theme saved before System mode existed as a fixed choice', () => {
        expect(mergeStoredSettings({ theme: { id: 'nord' } }, false).theme).toEqual({ id: 'nord', light: 'scrivon-light', dark: 'scrivon-dark' })
    })

    it("reads System mode and its light and dark themes, putting back a default for one that doesn't fit", () => {
        expect(mergeStoredSettings({ theme: { id: 'system', light: 'solarized-light', dark: 'dracula' } }, false).theme).toEqual({
            id: 'system',
            light: 'solarized-light',
            dark: 'dracula',
        })
        // A dark theme saved as the light one, and a theme this version doesn't know.
        expect(mergeStoredSettings({ theme: { id: 'system', light: 'dracula', dark: 'future-theme' } }, false).theme).toEqual({
            id: 'system',
            light: 'scrivon-light',
            dark: 'scrivon-dark',
        })
    })

    it('follows Windows when the saved theme is unknown, as a newer version may save', () => {
        expect(mergeStoredSettings({ theme: { id: 'future-theme' } }, false).theme.id).toBe('system')
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

    it('keeps the Outline panel closed by default, and reads a saved choice', () => {
        expect(mergeStoredSettings({}, false).layout.outlineOpen).toBe(false)
        expect(mergeStoredSettings({ layout: { outlineOpen: 'yes' } }, false).layout.outlineOpen).toBe(false)
        expect(mergeStoredSettings({ layout: { outlineOpen: true } }, false).layout.outlineOpen).toBe(true)
        expect(migrateLegacySettings(() => null, false).layout.outlineOpen).toBe(false)
    })

    it('keeps Tab indenting by default, and reads a saved Tab key moves focus choice', () => {
        expect(createDefaultSettings(false).editor.tabMovesFocus).toBe(false)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ editor: { fontSize: 14 } }, false).editor.tabMovesFocus).toBe(false)
        expect(mergeStoredSettings({ editor: { tabMovesFocus: true } }, false).editor.tabMovesFocus).toBe(true)
        expect(mergeStoredSettings({ editor: { tabMovesFocus: 'yes' } }, false).editor.tabMovesFocus).toBe(false)
    })

    it('links the editor and preview by default, and reads a saved choice', () => {
        expect(createDefaultSettings(false).editor.scrollSync).toBe(true)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ editor: { fontSize: 14 } }, false).editor.scrollSync).toBe(true)
        expect(mergeStoredSettings({ editor: { scrollSync: false } }, false).editor.scrollSync).toBe(false)
        expect(mergeStoredSettings({ editor: { scrollSync: 'no' } }, false).editor.scrollSync).toBe(true)
    })

    it('jumps from the preview to the editor on double-click by default, and reads a saved choice', () => {
        expect(createDefaultSettings(false).editor.jumpFromPreview).toBe(true)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ editor: { scrollSync: false } }, false).editor.jumpFromPreview).toBe(true)
        expect(mergeStoredSettings({ editor: { jumpFromPreview: false } }, false).editor.jumpFromPreview).toBe(false)
        expect(mergeStoredSettings({ editor: { jumpFromPreview: 1 } }, false).editor.jumpFromPreview).toBe(true)
    })

    it('reopens the last folder by default, and reads a saved choice', () => {
        expect(createDefaultSettings(false).workspace.reopenLastFolder).toBe(true)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ workspace: { maxRecentFolders: 5 } }, false).workspace.reopenLastFolder).toBe(true)
        expect(mergeStoredSettings({ workspace: { reopenLastFolder: false } }, false).workspace.reopenLastFolder).toBe(false)
        expect(mergeStoredSettings({ workspace: { reopenLastFolder: 'no' } }, false).workspace.reopenLastFolder).toBe(true)
        expect(migrateLegacySettings(() => null, false).workspace.reopenLastFolder).toBe(true)
    })

    it('shows the status bar unless the user hid it', () => {
        expect(createDefaultSettings(false).statusBar.visible).toBe(true)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ editor: { fontSize: 14 } }, false).statusBar.visible).toBe(true)
        expect(mergeStoredSettings({ statusBar: { visible: false } }, false).statusBar.visible).toBe(false)
        expect(mergeStoredSettings({ statusBar: { visible: 'no' } }, false).statusBar.visible).toBe(true)
    })

    it('wraps at column 80 unless another wrap column was saved, kept between 20 and 200', () => {
        expect(createDefaultSettings(false).editor.wordWrapColumn).toBe(80)
        // Settings saved before the option existed.
        expect(mergeStoredSettings({ editor: { wordWrap: 'wordWrapColumn' } }, false).editor.wordWrapColumn).toBe(80)
        expect(mergeStoredSettings({ editor: { wordWrapColumn: 100 } }, false).editor.wordWrapColumn).toBe(100)
        expect(mergeStoredSettings({ editor: { wordWrapColumn: 5 } }, false).editor.wordWrapColumn).toBe(20)
        expect(mergeStoredSettings({ editor: { wordWrapColumn: 999 } }, false).editor.wordWrapColumn).toBe(200)
        expect(mergeStoredSettings({ editor: { wordWrapColumn: 72.6 } }, false).editor.wordWrapColumn).toBe(73)
        expect(mergeStoredSettings({ editor: { wordWrapColumn: '100' } }, false).editor.wordWrapColumn).toBe(80)
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

        // Nothing usable was saved, so the default stays rather than leaving the action unassigned.
        expect(merged.keybinds['view.toggleEditor']).toEqual([{ key: 'e', ctrl: true }])
        expect(merged.keybinds['view.toggleExplorer']).toEqual([{ key: 'b', ctrl: true }])
        expect(merged.keybinds['palette.open']).toEqual([{ key: 'F1' }])
    })

    it('keeps the default for a shortcut saved as Tab, unless another action now has that chord', () => {
        const tabOnly = mergeStoredSettings({ keybinds: { 'palette.open': [{ key: 'Tab' }] } }, false)
        expect(tabOnly.keybinds['palette.open']).toEqual([{ key: 'F1' }])
        expect(keybindOverrides(tabOnly.keybinds, createDefaultKeybinds(false))).toEqual({})

        const taken = mergeStoredSettings({ keybinds: { 'palette.open': [{ key: 'Tab' }], 'view.fitDiagram': [{ key: 'F1' }] } }, false)
        expect(taken.keybinds['palette.open']).toEqual([])
        expect(taken.keybinds['view.fitDiagram']).toEqual([{ key: 'F1' }])
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

    it('keeps the default when a stored chord is AltGr or a lock key on its own', () => {
        const merged = mergeStoredSettings(
            {
                keybinds: {
                    'view.toggleExplorer': [{ key: 'AltGraph', ctrl: true, alt: true }],
                    'view.toggleEditor': [{ key: 'CapsLock', ctrl: true }],
                },
            },
            false
        )

        expect(merged.keybinds['view.toggleExplorer']).toEqual([{ key: 'b', ctrl: true }])
        expect(merged.keybinds['view.toggleEditor']).toEqual([{ key: 'e', ctrl: true }])
    })

    it('keeps the default when a stored chord is an IME or dead key', () => {
        const merged = mergeStoredSettings(
            {
                keybinds: {
                    'view.toggleExplorer': [{ key: 'Process', ctrl: true }],
                    'view.toggleEditor': [{ key: 'Dead', ctrl: true, alt: true }],
                },
            },
            false
        )

        expect(merged.keybinds['view.toggleExplorer']).toEqual([{ key: 'b', ctrl: true }])
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

    it('rounds whole-number settings saved with decimals', () => {
        const merged = mergeStoredSettings(
            {
                autosave: { enabled: true, delayMs: 1234.5 },
                editor: { fontSize: 13.6, tabSize: 2.5 },
                workspace: { maxRecentFolders: 7.2 },
            },
            false
        )

        expect(merged.autosave.delayMs).toBe(1235)
        expect(merged.editor.fontSize).toBe(14)
        expect(merged.editor.tabSize).toBe(3)
        expect(merged.workspace.maxRecentFolders).toBe(7)
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

    it('leaves out a default dropped because another action has its chord', () => {
        const defaults = createDefaultKeybinds(false)
        // Loaded from a save where Toggle explorer was given Ctrl+S.
        const keybinds = mergeStoredSettings({ keybinds: { 'view.toggleExplorer': [{ key: 's', ctrl: true }] } }, false).keybinds
        expect(keybinds['document.save']).toEqual([])

        const overrides = keybindOverrides(keybinds, defaults)

        expect(overrides).toEqual({ 'view.toggleExplorer': [{ key: 's', ctrl: true }] })
        expect(keybindsFromOverrides(overrides, defaults)).toEqual(keybinds)
        expect(keybindsFromOverrides({}, defaults)['document.save']).toEqual([{ key: 's', ctrl: true }])
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
                outlineOpen: false,
            })
        ).not.toThrow()
        expect(() => dualWriteLegacyAutosave(true)).not.toThrow()

        vi.unstubAllGlobals()
    })
})
