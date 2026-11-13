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
        /** Where lines wrap when wordWrap is 'wordWrapColumn'. */
        wordWrapColumn: number
        lineNumbers: EditorLineNumbers
        minimap: boolean
        /** Tab and Shift+Tab move focus out of the editor instead of indenting (Monaco's tab focus mode). */
        tabMovesFocus: boolean
        /** The editor and the Markdown preview scroll together. */
        scrollSync: boolean
        /** Double-clicking the Markdown preview moves the editor's cursor to that line. */
        jumpFromPreview: boolean
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
