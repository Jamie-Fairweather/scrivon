import { DEFAULT_APP_THEME, getSystemPreferredTheme, type AppThemeId } from '@/lib/theme/catalog'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { AppSettings, KeybindBindings, KeybindChord } from '@/lib/settings/types'

export const DEFAULT_EDITOR_WIDTH = 400
export const DEFAULT_AUTOSAVE_DELAY_MS = 400
export const DEFAULT_MAX_RECENT_FOLDERS = 10

function chord(key: string, modifiers: Partial<Omit<KeybindChord, 'key'>> = {}): KeybindChord {
    return { key, ...modifiers }
}

/**
 * Platform-specific default chords (Win/Linux use ctrl; macOS uses meta). Typed as KeybindBindings,
 * so every action needs an entry here, as it does in the keybind registry.
 */
export function createDefaultKeybinds(isMac: boolean): KeybindBindings {
    const mod = isMac ? { meta: true } : { ctrl: true }

    const bindings: KeybindBindings = {
        'document.save': [chord('s', mod)],
        'settings.open': [chord(',', mod)],
        'palette.open': [chord('F1')],
        'palette.openText': [chord('f', { ...mod, shift: true })],
        'palette.openFiles': [chord('n', { ...mod, shift: true })],
        'view.toggleExplorer': [chord('b', mod)],
        'view.toggleEditor': [chord('e', mod)],
        'view.previewOnly': [chord('o', { ...mod, shift: true })],
        'view.fitDiagram': [chord('r', mod)],
        'workspace.saveAll': [chord('s', { ...mod, shift: true })],
    }

    return bindings
}

/**
 * Scrivon Light or Dark, following the OS setting, which is also what the boot script paints
 * before React loads. A fixed dark default would flip a light-mode user to dark on first launch.
 */
function systemPreferredTheme(): AppThemeId {
    try {
        return getSystemPreferredTheme()
    } catch {
        // No matchMedia to ask.
        return DEFAULT_APP_THEME
    }
}

export function createDefaultSettings(isMac = false): AppSettings {
    return {
        autosave: {
            enabled: true,
            delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        },
        theme: {
            id: systemPreferredTheme(),
        },
        layout: {
            explorerOpen: true,
            editorOpen: true,
            editorWidth: DEFAULT_EDITOR_WIDTH,
            restorePanelsOnOpen: true,
        },
        editor: {
            fontSize: 13,
            tabSize: 2,
            wordWrap: 'on',
            wordWrapColumn: 80,
            lineNumbers: 'on',
            minimap: false,
            tabMovesFocus: false,
        },
        workspace: {
            maxRecentFolders: DEFAULT_MAX_RECENT_FOLDERS,
            reopenLastFolder: true,
        },
        updates: {
            checkOnLaunch: true,
        },
        pdfExport: createDefaultPdfExportSettings(),
        keybinds: createDefaultKeybinds(isMac),
    }
}
