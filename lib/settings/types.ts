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
    | 'palette.openReplace'
    | 'palette.openFiles'
    | 'view.toggleExplorer'
    | 'view.toggleEditor'
    | 'view.togglePreview'
    | 'view.previewOnly'
    | 'view.toggleFocusMode'
    | 'view.present'
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
    | 'view.splitEditor'
    | 'view.moveTabToOtherGroup'
    | 'view.focusOtherGroup'
    | 'view.joinGroups'
    | 'workspace.saveAll'
    | 'workspace.newDiagram'
    | 'workspace.newDocument'
    | 'workspace.newFolder'
    | 'workspace.newFromTemplate'
    | 'tabs.close'
    | 'tabs.next'
    | 'tabs.previous'
    | 'tabs.moveLeft'
    | 'tabs.moveRight'
    | 'tabs.reopenClosed'
    | 'format.bold'
    | 'format.italic'
    | 'format.code'
    | 'format.link'
    | 'format.insertTable'
    | 'format.table'

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
    /** Local history: a copy of each saved version of a file, kept in the app's data folder (File → Show File History…). */
    fileHistory: {
        /** Off keeps nothing new; versions already kept stay until deleted. */
        enabled: boolean
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
        /**
         * Only the editor shows, filling the window (the menu bar stays). A flag of its own, apart from the
         * panes above, so leaving it brings back exactly the layout there was.
         */
        focusMode: boolean
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
        /** Underlines links, images and `#anchors` in Markdown files that lead nowhere in the open folder. */
        checkLinks: boolean
        /** Fades every line but the paragraph (or paragraphs) the cursor or selection is in. */
        dimOtherParagraphs: boolean
    }
    workspace: {
        maxRecentFolders: number
        /** Reopen the folder (and its tabs) that was open when Scrivon last closed. */
        reopenLastFolder: boolean
        /** Marks the files git sees as changed, and the folders holding them, in the explorer. */
        showGitChanges: boolean
        /** After a rename or move in the explorer, lists the Markdown links it breaks and offers to fix them. */
        offerLinkUpdates: boolean
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
    /** Find in Workspace's options, switched in the palette and kept for next time (not in the Settings dialog). */
    workspaceSearch: {
        matchCase: boolean
        wholeWord: boolean
        useRegex: boolean
    }
    keybinds: Record<KeybindActionId, KeybindChord[]>
}

export type KeybindBindings = Record<KeybindActionId, KeybindChord[]>

export const SETTINGS_STORAGE_KEY = 'scrivon-settings:v1'
