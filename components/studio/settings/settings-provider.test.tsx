import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { loadSettings } from '@/lib/settings/storage'
import { SETTINGS_STORAGE_KEY, type AppSettings } from '@/lib/settings/types'

function stored(): AppSettings {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    expect(raw).not.toBe('undefined')
    return JSON.parse(raw ?? 'null') as AppSettings
}

function renderSettings() {
    return renderHook(() => useAppSettings(), { wrapper: SettingsProvider })
}

describe('SettingsProvider persistence', () => {
    beforeEach(() => {
        const store = new Map<string, string>()
        // Like a real browser, coerce values to strings (so undefined becomes "undefined").
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
            removeItem: (key: string) => {
                store.delete(key)
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('saves both of two updates made back to back', () => {
        const { result } = renderSettings()

        act(() => {
            result.current.setLayoutExplorerOpen(false)
            result.current.setLayoutEditorOpen(false)
        })

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

    it('refuses shortcuts that would break typing, and in-use shortcuts', () => {
        const { result } = renderSettings()
        let message: string | null = null

        act(() => {
            message = result.current.setKeybindChords('view.toggleEditor', [{ key: 'Tab' }])
        })
        expect(message).toMatch(/can't be used in shortcuts/)

        act(() => {
            message = result.current.setKeybindChords('view.toggleEditor', [{ key: 'b', ctrl: true }])
        })
        expect(message).toBe('Already assigned to Toggle explorer')

        act(() => {
            message = result.current.setKeybindChords('view.toggleEditor', [{ key: 'd', ctrl: true }])
        })
        expect(message).toBe('Ctrl+D is used by the editor')

        expect(result.current.settings.keybinds['view.toggleEditor']).toEqual([{ key: 'e', ctrl: true }])
    })

    it('reloads the latest settings after a restart', () => {
        const { result, unmount } = renderSettings()

        act(() => {
            result.current.updateSettings((current) => ({ ...current, editor: { ...current.editor, fontSize: 20 } }))
        })
        act(() => {
            result.current.setLayoutExplorerOpen(false)
            result.current.setLayoutEditorOpen(false)
        })
        unmount()

        const reloaded = loadSettings()
        expect(reloaded.editor.fontSize).toBe(20)
        expect(reloaded.layout).toMatchObject({ explorerOpen: false, editorOpen: false })
    })
})
