import type { AppThemeId } from '@/lib/theme/catalog'
import type { PdfExportSettings } from '@/lib/settings/pdf-export-types'
import type { SpellcheckSettings } from '@/lib/spellcheck/spellcheck-settings'

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
    | 'document.export'
    | 'settings.open'
    | 'palette.open'
    | 'palette.openText'
    | 'palette.openFiles'
    | 'view.toggleExplorer'
    | 'view.toggleEditor'
    | 'view.togglePreview'
    | 'view.previewOnly'
    | 'view.fitDiagram'
    | 'view.appZoomIn'
    | 'view.appZoomOut'
    | 'view.appZoomReset'
    | 'view.zoomDiagramIn'
    | 'view.zoomDiagramOut'
    | 'view.resetDiagramZoom'
    | 'view.focusExplorer'
    | 'view.focusEditor'
    | 'view.focusPreview'
    | 'view.focusNextPane'
    | 'view.focusPreviousPane'
    | 'workspace.saveAll'
    | 'workspace.newDiagram'
    | 'workspace.newDocument'
    | 'workspace.newFolder'
    | 'tabs.close'
    | 'tabs.next'
    | 'tabs.previous'
    | 'tabs.reopenClosed'
    | 'format.bold'
    | 'format.italic'
    | 'format.code'
    | 'format.link'

/** Where an action's keys work: anywhere, with a folder open, or while typing in the editor (where they come first). */
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

/** The theme exported diagrams are drawn in: the app's, or the light or dark version of it. */
export type DiagramExportTheme = 'app' | 'light' | 'dark'

export type DiagramExportSettings = {
    theme: DiagramExportTheme
    /** No background colour, for pasting onto slides. */
    transparent: boolean
}

export type AppSettings = {
    autosave: {
        enabled: boolean
        delayMs: number
    }
    theme: ThemeSetting
    appearance: {
        /** The whole app's zoom, one of APP_ZOOM_LEVELS: 1 is 100%. */
        zoom: number
        /** The Markdown preview's body text size in pixels. Headings, code and spacing grow with it. */
        previewFontSize: number
    }
    layout: {
        explorerOpen: boolean
        editorOpen: boolean
        /** The Markdown preview or the diagram. Never hidden while the editor is hidden too. */
        previewOpen: boolean
        editorWidth: number
        restorePanelsOnOpen: boolean
        /** The Outline panel, which lists the headings of the Markdown file on screen. */
        outlineOpen: boolean
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
        /** Reopen the folder (and its tabs) that was open when Scrivon last closed. */
        reopenLastFolder: boolean
    }
    updates: {
        checkOnLaunch: boolean
    }
    statusBar: {
        visible: boolean
    }
    pdfExport: PdfExportSettings
    /** How diagrams look when saved or copied as SVG or PNG. */
    diagramExport: DiagramExportSettings
    spellcheck: SpellcheckSettings
    keybinds: Record<KeybindActionId, KeybindChord[]>
}

export type KeybindBindings = Record<KeybindActionId, KeybindChord[]>

export const SETTINGS_STORAGE_KEY = 'scrivon-settings:v1'
