import type { AppThemeId } from '@/lib/theme/catalog'

export type EditorWordWrap = 'on' | 'off' | 'wordWrapColumn'
export type EditorLineNumbers = 'on' | 'off' | 'relative'

export type KeybindChord = {
    key: string
    ctrl?: boolean
    meta?: boolean
    shift?: boolean
    alt?: boolean
}

export type KeybindActionId =
    | 'document.save'
    | 'settings.open'
    | 'palette.open'
    | 'palette.openText'
    | 'palette.openFiles'
    | 'view.toggleExplorer'
    | 'view.toggleEditor'
    | 'view.previewOnly'
    | 'view.fitDiagram'
    | 'workspace.saveAll'

export type KeybindWhen = 'global' | 'workspace' | 'editor'

export type AppSettings = {
    autosave: {
        enabled: boolean
        delayMs: number
    }
    theme: {
        id: AppThemeId
    }
    layout: {
        explorerOpen: boolean
        editorOpen: boolean
        editorWidth: number
        restorePanelsOnOpen: boolean
    }
    editor: {
        fontSize: number
        tabSize: number
        wordWrap: EditorWordWrap
        lineNumbers: EditorLineNumbers
        minimap: boolean
    }
    workspace: {
        maxRecentFolders: number
    }
    updates: {
        checkOnLaunch: boolean
    }
    keybinds: Record<KeybindActionId, KeybindChord[]>
}

export type KeybindBindings = Record<KeybindActionId, KeybindChord[]>

export const SETTINGS_STORAGE_KEY = 'scrivon-settings:v1'
