import { invoke } from '@tauri-apps/api/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    SETTINGS_SECTION_STORAGE_KEY,
    SettingsProvider,
    useAppSettings,
    useFlushPendingSettings,
    type KeybindRefusal,
} from '@/components/studio/settings/settings-provider'
import { notifyWarning } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { createPdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import { loadSettings, SETTINGS_BACKUP_KEY } from '@/lib/settings/storage'
import { SETTINGS_STORAGE_KEY, type AppSettings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/lib/notify', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/notify')>()), notifyWarning: vi.fn() }))

function stored(): AppSettings {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    expect(raw).not.toBe('undefined')
    return JSON.parse(raw ?? 'null') as AppSettings
}

/** How many times the settings were written to storage since the provider mounted. */
let settingsWrites = 0

function renderSettings() {
    const rendered = renderHook(() => useAppSettings(), { wrapper: SettingsProvider })
    // Loading writes the settings back once in the current format.
    settingsWrites = 0
    return rendered
}

/** Hides the editor in the settings. */
function hideEditor(current: AppSettings): AppSettings {
    return { ...current, layout: { ...current.layout, editorOpen: false } }
}

/** Settings are written a moment after the last change. */
function waitForSave() {
    act(() => {
        vi.advanceTimersByTime(300)
    })
}

describe('SettingsProvider persistence', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        const store = new Map<string, string>()
        // Like a real browser, coerce values to strings (so undefined becomes "undefined").
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                if (key === SETTINGS_STORAGE_KEY) settingsWrites += 1
                store.set(key, String(value))
            },
            removeItem: (key: string) => {
                store.delete(key)
            },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('saves both of two updates made back to back', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.setLayoutExplorerOpen(false)
            result.current.updateSettings(hideEditor)
        })
        waitForSave()

        expect(stored().layout).toMatchObject({ explorerOpen: false, editorOpen: false })
        expect(result.current.settings.layout).toMatchObject({ explorerOpen: false, editorOpen: false })
    })

    it('keeps saving after the provider has re-rendered', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.updateSettings((current) => ({ ...current, editor: { ...current.editor, fontSize: 20 } }))
        })
        act(() => {
            result.current.setEditorWidth(500)
        })
        act(() => {
            result.current.setEditorWidth(640)
        })
        waitForSave()

        expect(stored().editor.fontSize).toBe(20)
        expect(stored().layout.editorWidth).toBe(640)
    })

    it('saves changes made while the settings dialog is open', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.openSettings('editor')
        })
        act(() => {
            result.current.updateSettings((current) => ({ ...current, editor: { ...current.editor, tabSize: 4 } }))
        })
        waitForSave()

        expect(stored().editor.tabSize).toBe(4)
    })

    it('reopens settings on the last used section', () => {
        const { result } = renderSettings()

        expect(result.current.activeSection).toBe('general')
        act(() => {
            result.current.openSettings('keyboard')
        })
        act(() => {
            result.current.closeSettings()
        })
        act(() => {
            result.current.openSettings()
        })

        expect(result.current.settingsOpen).toBe(true)
        expect(result.current.activeSection).toBe('keyboard')
    })

    it('reopens settings on the last used section after a restart', () => {
        const first = renderSettings()
        act(() => {
            first.result.current.openSettings('pdf-export')
        })
        first.unmount()

        const { result } = renderSettings()
        act(() => {
            result.current.openSettings()
        })

        expect(result.current.activeSection).toBe('pdf-export')
    })

    it('opens on General when the remembered section is unknown', () => {
        localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, 'sync')

        const { result } = renderSettings()

        expect(result.current.activeSection).toBe('general')
    })

    it('refuses shortcuts that would break typing, and in-use shortcuts', () => {
        const { result } = renderSettings()
        let refusal: KeybindRefusal | null = null

        act(() => {
            refusal = result.current.setKeybindChords('view.toggleEditor', [{ key: 'Tab' }])
        })
        expect(refusal).toEqual({ message: expect.stringMatching(/can't be used in shortcuts/) })

        act(() => {
            refusal = result.current.setKeybindChords('view.toggleEditor', [{ key: 'b', ctrl: true }])
        })
        expect(refusal).toEqual({ message: 'Ctrl+B is already assigned to Toggle explorer', reassign: [{ key: 'b', ctrl: true }] })

        act(() => {
            refusal = result.current.setKeybindChords('view.toggleEditor', [{ key: 'd', ctrl: true }])
        })
        expect(refusal).toEqual({ message: 'Ctrl+D is used by the editor' })

        expect(result.current.settings.keybinds['view.toggleEditor']).toEqual([{ key: 'e', ctrl: true }])
    })

    it('does not reset a shortcut to a default another action now uses', () => {
        const { result } = renderSettings()
        let refusal: KeybindRefusal | null = null

        act(() => {
            result.current.setKeybindChords('document.save', [])
        })
        act(() => {
            result.current.setKeybindChords('settings.open', [{ key: 's', ctrl: true }])
        })
        act(() => {
            refusal = result.current.resetKeybind('document.save')
        })

        expect(refusal).toEqual({ message: 'Ctrl+S is already assigned to Open settings', reassign: [{ key: 's', ctrl: true }] })
        expect(result.current.settings.keybinds['document.save']).toEqual([])
        expect(result.current.settings.keybinds['settings.open']).toEqual([{ key: 's', ctrl: true }])

        act(() => {
            result.current.resetKeybind('settings.open')
        })
        act(() => {
            refusal = result.current.resetKeybind('document.save')
        })
        expect(refusal).toBeNull()
        expect(result.current.settings.keybinds['document.save']).toEqual([{ key: 's', ctrl: true }])
    })

    it('moves a shortcut from the action that has it when reassigned', () => {
        const { result } = renderSettings()
        let refusal: KeybindRefusal | null = null

        act(() => {
            refusal = result.current.reassignKeybind('view.toggleEditor', [{ key: 'b', ctrl: true }])
        })

        expect(refusal).toBeNull()
        expect(result.current.settings.keybinds['view.toggleEditor']).toEqual([{ key: 'b', ctrl: true }])
        expect(result.current.settings.keybinds['view.toggleExplorer']).toEqual([])
        expect(result.current.settings.keybinds['document.save']).toEqual([{ key: 's', ctrl: true }])
        // Not saved as cleared: it loads without Ctrl+B only while another action has it.
        expect(stored().keybinds).not.toHaveProperty('view.toggleExplorer')

        act(() => {
            refusal = result.current.reassignKeybind('view.toggleEditor', [{ key: 'c', ctrl: true }])
        })
        expect(refusal).toEqual({ message: 'Ctrl+C is used by the editor' })
        expect(result.current.settings.keybinds['view.toggleEditor']).toEqual([{ key: 'b', ctrl: true }])

        act(() => {
            result.current.resetKeybind('view.toggleEditor')
        })
        expect(result.current.settings.keybinds['view.toggleExplorer']).toEqual([{ key: 'b', ctrl: true }])
    })

    it('gives a default back once its chord is free, instead of saving it as cleared', () => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ keybinds: { 'view.toggleExplorer': [{ key: 's', ctrl: true }] } }))
        const { result, unmount } = renderSettings()
        expect(result.current.settings.keybinds['document.save']).toEqual([])

        // Any other change saves settings; Save's missing default must not be saved as "cleared".
        act(() => {
            result.current.setEditorWidth(500)
        })
        waitForSave()
        expect(stored().keybinds).toEqual({ 'view.toggleExplorer': [{ key: 's', ctrl: true }] })

        act(() => {
            result.current.resetKeybind('view.toggleExplorer')
        })
        waitForSave()
        expect(result.current.settings.keybinds['document.save']).toEqual([{ key: 's', ctrl: true }])
        expect(stored().keybinds).toEqual({})
        unmount()

        expect(loadSettings().keybinds['document.save']).toEqual([{ key: 's', ctrl: true }])
    })

    it('keeps a shortcut the user cleared cleared', () => {
        const { result, unmount } = renderSettings()

        act(() => {
            result.current.setKeybindChords('document.save', [])
        })
        act(() => {
            result.current.setEditorWidth(500)
        })
        unmount()

        expect(stored().keybinds).toEqual({ 'document.save': [] })
        expect(loadSettings().keybinds['document.save']).toEqual([])
    })

    it('keeps export profiles when restoring defaults', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.updateSettings((current) => ({
                ...current,
                editor: { ...current.editor, fontSize: 20 },
                pdfExport: createPdfExportProfile(current.pdfExport, 'Company report'),
            }))
        })
        const profiles = result.current.settings.pdfExport

        act(() => {
            result.current.resetAllSettings()
        })

        expect(result.current.settings.editor.fontSize).toBe(createDefaultSettings(false).editor.fontSize)
        expect(result.current.settings.pdfExport).toEqual(profiles)
        expect(stored().pdfExport.profiles.map((profile) => profile.name)).toContain('Company report')
    })

    it('keeps the user’s dictionary when restoring defaults', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.updateSettings((current) => ({ ...current, spellcheck: { ...current.spellcheck, enabled: false, words: ['Scrivon'] } }))
        })
        act(() => {
            result.current.resetAllSettings()
        })

        expect(result.current.settings.spellcheck.enabled).toBe(true)
        expect(result.current.settings.spellcheck.words).toEqual(['Scrivon'])
        expect(stored().spellcheck.words).toEqual(['Scrivon'])
    })

    it('goes back to following Windows light/dark when everything is reset', () => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: 'tokyo-night' } }))
        const { result } = renderSettings()
        expect(result.current.settings.theme.id).toBe('tokyo-night')

        act(() => {
            result.current.resetAllSettings()
        })

        expect(result.current.settings.theme).toEqual({ id: 'system', light: 'scrivon-light', dark: 'scrivon-dark' })
    })

    it("keeps System mode's light and dark themes when a fixed theme is picked", () => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: 'system', light: 'solarized-light', dark: 'dracula' } }))
        const { result } = renderSettings()

        act(() => {
            result.current.setThemeId('nord')
        })

        expect(stored().theme).toEqual({ id: 'nord', light: 'solarized-light', dark: 'dracula' })
    })

    it("turns System mode on and off, keeping the current theme, and sets System mode's themes", () => {
        const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: { id: 'nord' } }))
        const { result } = renderSettings()

        act(() => {
            result.current.setFollowSystem(true)
        })
        expect(stored().theme).toEqual({ id: 'system', light: 'scrivon-light', dark: 'nord' })

        act(() => {
            result.current.setSystemThemeId('github-light')
            result.current.setSystemThemeId('dracula')
        })
        expect(result.current.settings.theme).toEqual({ id: 'system', light: 'github-light', dark: 'dracula' })

        act(() => {
            result.current.setFollowSystem(false)
        })
        expect(result.current.settings.theme).toEqual({ id: 'dracula', light: 'github-light', dark: 'dracula' })
        matchMedia.mockRestore()
    })

    it('tells the user when unreadable settings were restored from the backup', () => {
        const backup = createDefaultSettings(false)
        backup.editor.fontSize = 18
        localStorage.setItem(SETTINGS_BACKUP_KEY, JSON.stringify(backup))
        localStorage.setItem(SETTINGS_STORAGE_KEY, 'undefined')

        const { result } = renderSettings()

        expect(result.current.settings.editor.fontSize).toBe(18)
        expect(notifyWarning).toHaveBeenCalledWith('Settings could not be read', expect.objectContaining({ id: 'settings-recovered' }))
    })

    it("hands the export profiles' images to Rust when the desktop app starts", () => {
        const saved = createDefaultSettings(false)
        saved.pdfExport.profiles[0]!.brand.logoPath = 'C:/brand/cover.png'
        saved.pdfExport.profiles[0]!.footer.left.imagePath = 'C:/brand/logo.png'
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved))
        vi.mocked(invoke).mockClear()
        vi.mocked(isTauri).mockReturnValue(true)
        try {
            renderSettings()
        } finally {
            vi.mocked(isTauri).mockReturnValue(false)
        }

        // Once, beside the copy of the settings in settings.json.
        expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(['save_settings_file', 'adopt_export_images'])
        expect(invoke).toHaveBeenCalledWith('adopt_export_images', { paths: ['C:/brand/cover.png', 'C:/brand/logo.png'] })
    })

    it('writes a change on its own at once, so closing the window right after keeps it', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.setThemeId('scrivon-light')
        })

        expect(settingsWrites).toBe(1)
        expect(stored().theme.id).toBe('scrivon-light')
        waitForSave()
        expect(settingsWrites).toBe(1)
    })

    it('writes the first of a burst of changes at once, and the rest once, shortly after the last one', () => {
        const { result } = renderSettings()

        for (const width of [500, 510, 520, 530]) {
            act(() => {
                result.current.setEditorWidth(width)
            })
            act(() => {
                vi.advanceTimersByTime(100)
            })
        }
        expect(settingsWrites).toBe(1)
        expect(stored().layout.editorWidth).toBe(500)
        expect(result.current.settings.layout.editorWidth).toBe(530)

        waitForSave()
        expect(settingsWrites).toBe(2)
        expect(stored().layout.editorWidth).toBe(530)
        waitForSave()
        expect(settingsWrites).toBe(2)

        // Once the burst is over, the next change is written at once again.
        act(() => {
            result.current.setEditorWidth(600)
        })
        expect(settingsWrites).toBe(3)
        expect(stored().layout.editorWidth).toBe(600)
    })

    /** Two changes back to back: the first is written at once, the second waits. */
    function changeWidthTwice(result: { current: ReturnType<typeof useAppSettings> }) {
        act(() => {
            result.current.setEditorWidth(600)
        })
        act(() => {
            result.current.setEditorWidth(640)
        })
        expect(settingsWrites).toBe(1)
        expect(stored().layout.editorWidth).toBe(600)
    }

    it.each([
        ['the page is hidden', () => window.dispatchEvent(new Event('pagehide'))],
        ['the page is about to unload', () => window.dispatchEvent(new Event('beforeunload'))],
        [
            'the app is hidden',
            () => {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
                document.dispatchEvent(new Event('visibilitychange'))
            },
        ],
    ])('writes a waiting change at once when %s', (_, leave) => {
        const { result } = renderSettings()
        changeWidthTwice(result)

        leave()

        expect(settingsWrites).toBe(2)
        expect(stored().layout.editorWidth).toBe(640)
    })

    it('gives the title bar and the close handler the same way to write a waiting change, which does nothing outside it', () => {
        const { result } = renderHook(() => ({ settings: useAppSettings(), flush: useFlushPendingSettings() }), { wrapper: SettingsProvider })
        settingsWrites = 0
        act(() => {
            result.current.settings.setEditorWidth(600)
        })
        act(() => {
            result.current.settings.setEditorWidth(640)
        })
        expect(settingsWrites).toBe(1)

        act(() => {
            result.current.flush()
        })
        expect(settingsWrites).toBe(2)
        expect(stored().layout.editorWidth).toBe(640)

        // The last-resort error screen has no SettingsProvider above it.
        const outside = renderHook(() => useFlushPendingSettings())
        expect(() => outside.result.current()).not.toThrow()
    })

    it('writes a waiting change when the provider unmounts', () => {
        const { result, unmount } = renderSettings()
        changeWidthTwice(result)

        unmount()

        expect(settingsWrites).toBe(2)
        expect(stored().layout.editorWidth).toBe(640)
    })

    it('writes at once when Settings closes', () => {
        const { result } = renderSettings()
        act(() => {
            result.current.openSettings('editor')
        })
        for (const tabSize of [2, 4]) {
            act(() => {
                result.current.updateSettings((current) => ({ ...current, editor: { ...current.editor, tabSize } }))
            })
        }
        expect(settingsWrites).toBe(1)

        act(() => {
            result.current.closeSettings()
        })

        expect(settingsWrites).toBe(2)
        expect(stored().editor.tabSize).toBe(4)
    })

    it('writes at once when all settings are restored to their defaults', () => {
        const { result } = renderSettings()
        act(() => {
            result.current.setEditorWidth(640)
        })

        act(() => {
            result.current.resetAllSettings()
        })

        expect(settingsWrites).toBe(2)
        expect(stored().layout.editorWidth).toBe(createDefaultSettings(false).layout.editorWidth)
    })

    it('reloads the latest settings after a restart', () => {
        const { result, unmount } = renderSettings()

        act(() => {
            result.current.updateSettings((current) => ({ ...current, editor: { ...current.editor, fontSize: 20 } }))
        })
        act(() => {
            result.current.setLayoutExplorerOpen(false)
            result.current.updateSettings(hideEditor)
        })
        unmount()

        const reloaded = loadSettings()
        expect(reloaded.editor.fontSize).toBe(20)
        expect(reloaded.layout).toMatchObject({ explorerOpen: false, editorOpen: false })
    })

    it('starts with the panels as they were left while Restore panel layout is on', () => {
        const first = renderSettings()
        act(() => {
            first.result.current.setLayoutExplorerOpen(false)
            first.result.current.updateSettings(hideEditor)
        })
        first.unmount()

        const { result } = renderSettings()
        expect(result.current.settings.layout).toMatchObject({ explorerOpen: false, editorOpen: false })
    })

    it('remembers a hidden preview after a restart', () => {
        const first = renderSettings()
        act(() => first.result.current.updateSettings((current) => ({ ...current, layout: { ...current.layout, previewOpen: false } })))
        first.unmount()

        const { result } = renderSettings()
        expect(result.current.settings.layout).toMatchObject({ editorOpen: true, previewOpen: false })
    })

    it('starts with the preview shown while Restore panel layout is off', () => {
        const first = renderSettings()
        act(() =>
            first.result.current.updateSettings((current) => ({
                ...current,
                layout: { ...current.layout, restorePanelsOnOpen: false, previewOpen: false },
            }))
        )
        first.unmount()

        const { result } = renderSettings()
        expect(result.current.settings.layout).toMatchObject({ editorOpen: true, previewOpen: true })
    })

    it('starts with the explorer and editor shown, and the outline hidden, while Restore panel layout is off', () => {
        const first = renderSettings()
        act(() => {
            first.result.current.updateSettings((current) => ({
                ...current,
                layout: { ...current.layout, restorePanelsOnOpen: false, outlineOpen: true },
            }))
            first.result.current.setLayoutExplorerOpen(false)
            first.result.current.updateSettings(hideEditor)
            first.result.current.setEditorWidth(600)
        })
        first.unmount()

        const { result } = renderSettings()
        expect(result.current.settings.layout).toEqual({
            explorerOpen: true,
            editorOpen: true,
            previewOpen: true,
            editorWidth: 600,
            restorePanelsOnOpen: false,
            outlineOpen: false,
        })
        // Hiding a panel still works, and is still saved.
        act(() => result.current.updateSettings(hideEditor))
        waitForSave()
        expect(stored().layout.editorOpen).toBe(false)
    })
})
