import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import { FOLLOW_SYSTEM, type AppSettings, type KeybindBindings, type KeybindChord } from '@/lib/settings/types'
import { createDefaultSpellcheckSettings } from '@/lib/spellcheck/spellcheck-settings'

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
        'view.focusExplorer': [chord('e', { ...mod, shift: true })],
        'view.focusEditor': [chord('1', mod)],
        'view.focusPreview': [chord('2', mod)],
        'view.focusNextPane': [chord('F6')],
        'view.focusPreviousPane': [chord('F6', { shift: true })],
        'workspace.saveAll': [chord('s', { ...mod, shift: true })],
    }

    return bindings
}

export function createDefaultSettings(isMac = false): AppSettings {
    return {
        autosave: {
            enabled: true,
            delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        },
        // Follows Windows light/dark. Settings saved before System mode keep their fixed theme (migrate.ts).
        theme: {
            id: FOLLOW_SYSTEM,
            light: SYSTEM_LIGHT_THEME,
            dark: SYSTEM_DARK_THEME,
        },
        layout: {
            explorerOpen: true,
            editorOpen: true,
            editorWidth: DEFAULT_EDITOR_WIDTH,
            restorePanelsOnOpen: true,
            outlineOpen: false,
        },
        editor: {
            fontSize: 13,
            tabSize: 2,
            wordWrap: 'on',
            wordWrapColumn: 80,
            lineNumbers: 'on',
            minimap: false,
            tabMovesFocus: false,
            scrollSync: true,
            jumpFromPreview: true,
        },
        workspace: {
            maxRecentFolders: DEFAULT_MAX_RECENT_FOLDERS,
            reopenLastFolder: true,
        },
        updates: {
            checkOnLaunch: true,
        },
        statusBar: {
            visible: true,
        },
        pdfExport: createDefaultPdfExportSettings(),
        spellcheck: createDefaultSpellcheckSettings(),
        keybinds: createDefaultKeybinds(isMac),
    }
}
