import type { AppThemeId } from '@/lib/theme/catalog'
import type { PdfExportSettings } from '@/lib/settings/pdf-export-types'

export type EditorWordWrap = 'on' | 'off' | 'wordWrapColumn'
export type EditorLineNumbers = 'on' | 'off' | 'relative'

export type { PdfExportSettings }

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

/** 'system' follows the Windows light/dark setting. */
export const FOLLOW_SYSTEM = 'system'

export type ThemeChoice = AppThemeId | typeof FOLLOW_SYSTEM

export type ThemeSetting = {
    /** A fixed theme, or 'system' to follow Windows. Older versions read 'system' as "follow the OS" too. */
    id: ThemeChoice
    /** The theme System mode uses when Windows is light. */
    light: AppThemeId
    /** The theme System mode uses when Windows is dark. */
    dark: AppThemeId
}

export type AppSettings = {
    autosave: {
        enabled: boolean
        delayMs: number
    }
    theme: ThemeSetting
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
        /** Where lines wrap when wordWrap is 'wordWrapColumn'. */
        wordWrapColumn: number
        lineNumbers: EditorLineNumbers
        minimap: boolean
        /** Tab and Shift+Tab move focus out of the editor instead of indenting (Monaco's tab focus mode). */
        tabMovesFocus: boolean
    }
    workspace: {
        maxRecentFolders: number
    }
    updates: {
        checkOnLaunch: boolean
    }
    pdfExport: PdfExportSettings
    keybinds: Record<KeybindActionId, KeybindChord[]>
}

export type KeybindBindings = Record<KeybindActionId, KeybindChord[]>

export const SETTINGS_STORAGE_KEY = 'scrivon-settings:v1'
