import { DEFAULT_APP_THEME } from '@/lib/theme/catalog'
import type { AppSettings, KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

export const DEFAULT_EDITOR_WIDTH = 400
export const DEFAULT_AUTOSAVE_DELAY_MS = 400
export const DEFAULT_MAX_RECENT_FOLDERS = 10

function chord(key: string, modifiers: Partial<Omit<KeybindChord, 'key'>> = {}): KeybindChord {
    return { key, ...modifiers }
}

/** Platform-specific default chords (Win/Linux use ctrl; macOS uses meta). */
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

export function createDefaultSettings(isMac = false): AppSettings {
    return {
        autosave: {
            enabled: true,
            delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        },
        theme: {
            id: DEFAULT_APP_THEME,
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
            lineNumbers: 'on',
            minimap: false,
        },
        workspace: {
            maxRecentFolders: DEFAULT_MAX_RECENT_FOLDERS,
        },
        updates: {
            checkOnLaunch: true,
        },
        keybinds: createDefaultKeybinds(isMac),
    }
}

export const KEYBIND_ACTION_IDS: KeybindActionId[] = [
    'document.save',
    'settings.open',
    'palette.open',
    'palette.openText',
    'palette.openFiles',
    'view.toggleExplorer',
    'view.toggleEditor',
    'view.previewOnly',
    'view.fitDiagram',
    'workspace.saveAll',
]
