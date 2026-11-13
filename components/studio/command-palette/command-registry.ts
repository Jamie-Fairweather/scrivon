import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { exampleIdFromTabId, isExampleTabId } from '@/lib/examples/example-tab'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import { isLightTheme, SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME, type AppThemeId } from '@/lib/theme/catalog'
import { getBaseName, samePath } from '@/lib/tauri/fs'
import type { KeybindBindings } from '@/lib/settings/types'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'
import { displayPath } from '@/lib/workspace/display-path'

export type CommandRegistryContext = {
    isDesktop: boolean
    workspaceRoot: string | null
    recentWorkspaces: string[]
    activeTabId: string | null
    /** How many tabs are open, examples included. */
    tabCount: number
    hasDirtyTabs: boolean
    autosaveEnabled: boolean
    explorerOpen: boolean
    editorOpen: boolean
    outlineOpen: boolean
    /** True while a diagram is drawn on screen (a Mermaid tab, or a Markdown diagram opened full size). */
    canFitDiagram: boolean
    keybinds: KeybindBindings
    pickAndOpenWorkspace: () => Promise<void>
    openWorkspace: (path: string) => Promise<void>
    closeWorkspace: () => Promise<void>
    refreshTree: () => Promise<void>
    flushSave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    setAutosaveEnabled: (enabled: boolean) => void
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setOutlineOpen: (open: boolean) => void
    setPreviewOnly: () => void
    requestCanvasFit: () => void
    closeTab: (id: string) => Promise<void>
    closeOtherTabs: (keepId: string) => Promise<void>
    closeAllTabs: () => Promise<void>
    openExample: (exampleId: string) => void
    saveExampleCopy: (exampleId: string) => Promise<void>
    openSettings: () => void
    isLight: boolean
    toggleLightDark: () => void
}

function shortcut(actionId: Parameters<typeof formatKeybindForAction>[0], keybinds: KeybindBindings): string | undefined {
    return formatKeybindForAction(actionId, keybinds)
}

export function buildCommandRegistry(ctx: CommandRegistryContext): ActionPaletteItem[] {
    const hasWorkspace = Boolean(ctx.workspaceRoot)
    // Tabs are only on screen while a folder is open, so tab commands need both.
    const hasActiveTab = Boolean(ctx.activeTabId) && hasWorkspace
    const hasWorkspaceTab = hasActiveTab && ctx.activeTabId !== null && !isExampleTabId(ctx.activeTabId)
    const activeExampleId = hasActiveTab && ctx.activeTabId !== null ? exampleIdFromTabId(ctx.activeTabId) : null

    const actions: ActionPaletteItem[] = [
        {
            kind: 'action',
            value: 'action:open-settings',
            searchText: 'settings preferences options',
            label: 'Open Settings',
            shortcut: shortcut('settings.open', ctx.keybinds),
            run: () => ctx.openSettings(),
        },
        {
            kind: 'action',
            value: 'action:open-folder',
            searchText: 'open folder workspace',
            label: 'Open Folder',
            disabled: !ctx.isDesktop,
            disabledReason: 'Desktop only',
            run: () => void ctx.pickAndOpenWorkspace(),
        },
        {
            kind: 'action',
            value: 'action:close-folder',
            searchText: 'close folder workspace',
            label: 'Close Folder',
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => void ctx.closeWorkspace(),
        },
        {
            kind: 'action',
            value: 'action:refresh-explorer',
            searchText: 'refresh reload explorer files',
            label: 'Refresh Explorer',
            disabled: !hasWorkspace,
            disabledReason: 'Open a folder first',
            run: () => void ctx.refreshTree(),
        },
        {
            kind: 'action',
            value: 'action:save',
            searchText: 'save file',
            label: 'Save',
            shortcut: shortcut('document.save', ctx.keybinds),
            disabled: !hasWorkspaceTab,
            disabledReason: 'No workspace file open',
            run: () => {
                if (ctx.activeTabId) void ctx.flushSave(ctx.activeTabId)
            },
        },
        {
            kind: 'action',
            value: 'action:save-all',
            searchText: 'save all files',
            label: 'Save All',
            shortcut: shortcut('workspace.saveAll', ctx.keybinds),
            disabled: !hasWorkspace || !ctx.hasDirtyTabs,
            disabledReason: 'Nothing to save',
            run: () => void ctx.flushAllSaves(),
        },
        {
            kind: 'action',
            value: 'action:save-example-copy',
            searchText: 'save copy example workspace folder',
            label: 'Save Copy to Workspace',
            disabled: activeExampleId === null,
            disabledReason: hasWorkspace ? 'No example open' : 'Open a folder first',
            run: () => {
                if (activeExampleId) void ctx.saveExampleCopy(activeExampleId)
            },
        },
        {
            kind: 'action',
            value: 'action:toggle-autosave',
            searchText: 'autosave toggle',
            label: ctx.autosaveEnabled ? 'Disable Autosave' : 'Enable Autosave',
            run: () => ctx.setAutosaveEnabled(!ctx.autosaveEnabled),
        },
        {
            kind: 'action',
            value: 'action:toggle-explorer',
            searchText: 'explorer sidebar toggle',
            label: ctx.explorerOpen ? 'Hide Explorer' : 'Show Explorer',
            shortcut: shortcut('view.toggleExplorer', ctx.keybinds),
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => ctx.setExplorerOpen(!ctx.explorerOpen),
        },
        {
            kind: 'action',
            value: 'action:toggle-editor',
            searchText: 'editor toggle',
            label: ctx.editorOpen ? 'Hide Editor' : 'Show Editor',
            shortcut: shortcut('view.toggleEditor', ctx.keybinds),
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => ctx.setEditorOpen(!ctx.editorOpen),
        },
        {
            kind: 'action',
            value: 'action:toggle-outline',
            searchText: 'outline headings contents toggle',
            label: ctx.outlineOpen ? 'Hide Outline' : 'Show Outline',
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => ctx.setOutlineOpen(!ctx.outlineOpen),
        },
        {
            kind: 'action',
            value: 'action:preview-only',
            searchText: 'preview only layout',
            label: 'Preview Only',
            shortcut: shortcut('view.previewOnly', ctx.keybinds),
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => ctx.setPreviewOnly(),
        },
        {
            kind: 'action',
            value: 'action:fit-diagram',
            searchText: 'fit diagram canvas screen',
            label: 'Fit Diagram to Screen',
            shortcut: shortcut('view.fitDiagram', ctx.keybinds),
            disabled: !hasWorkspace || !ctx.canFitDiagram,
            disabledReason: hasWorkspace ? 'No diagram to fit' : 'No folder open',
            run: () => ctx.requestCanvasFit(),
        },
        {
            kind: 'action',
            value: 'action:close-tab',
            searchText: 'close tab',
            label: 'Close Tab',
            disabled: !hasActiveTab,
            disabledReason: 'No tab open',
            run: () => {
                if (ctx.activeTabId) void ctx.closeTab(ctx.activeTabId)
            },
        },
        {
            kind: 'action',
            value: 'action:close-other-tabs',
            searchText: 'close other tabs',
            label: 'Close Other Tabs',
            disabled: !hasActiveTab || ctx.tabCount < 2,
            disabledReason: hasActiveTab ? 'Only one tab open' : 'No tab open',
            run: () => {
                if (ctx.activeTabId) void ctx.closeOtherTabs(ctx.activeTabId)
            },
        },
        {
            kind: 'action',
            value: 'action:close-all-tabs',
            searchText: 'close all tabs',
            label: 'Close All Tabs',
            disabled: !hasActiveTab,
            disabledReason: 'No tabs open',
            run: () => void ctx.closeAllTabs(),
        },
        {
            kind: 'action',
            value: 'action:toggle-theme',
            searchText: 'theme light dark toggle',
            label: ctx.isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme',
            run: () => ctx.toggleLightDark(),
        },
    ]

    for (const example of APP_EXAMPLES) {
        actions.push({
            kind: 'action',
            value: `action:example:${example.id}`,
            searchText: `example ${example.title} ${example.category}`,
            label: `Open Example: ${example.title}`,
            // With no folder open only the welcome screen shows, so the example tab would stay hidden.
            disabled: !hasWorkspace,
            disabledReason: 'Open a folder first',
            run: () => ctx.openExample(example.id),
        })
    }

    for (const path of ctx.recentWorkspaces) {
        const current = ctx.workspaceRoot !== null && samePath(path, ctx.workspaceRoot)
        actions.push({
            kind: 'action',
            value: `action:recent-workspace:${path}`,
            searchText: `recent workspace ${getBaseName(path)} ${path}`,
            label: `Open Recent Folder: ${getBaseName(path)}`,
            // Two recent folders can share a name, so show where each one is (the note first, so it isn't cut off).
            detail: current ? `Current folder · ${displayPath(path)}` : displayPath(path),
            disabled: !ctx.isDesktop,
            disabledReason: 'Desktop only',
            run: () => void ctx.openWorkspace(path),
        })
    }

    return actions
}

/** The other half of each theme family that has both a light and a dark version. */
export const THEME_TWINS: Partial<Record<AppThemeId, AppThemeId>> = {
    'scrivon-light': 'scrivon-dark',
    'scrivon-dark': 'scrivon-light',
    'zinc-light': 'zinc-dark',
    'zinc-dark': 'zinc-light',
    'tokyo-night': 'tokyo-night-light',
    'tokyo-night-storm': 'tokyo-night-light',
    'tokyo-night-light': 'tokyo-night',
    'catppuccin-mocha': 'catppuccin-latte',
    'catppuccin-latte': 'catppuccin-mocha',
    nord: 'nord-light',
    'nord-light': 'nord',
    'github-light': 'github-dark',
    'github-dark': 'github-light',
    'solarized-light': 'solarized-dark',
    'solarized-dark': 'solarized-light',
}

/** The last light/dark switch, so switching back returns to the theme the user had. */
export type ThemeToggle = { from: AppThemeId; to: AppThemeId }

/**
 * Where 'Switch to Light/Dark Theme' goes from `current`: back to the theme the last switch
 * came from, else the same family's light or dark twin, else Scrivon Light or Dark.
 */
export function themeToggleTarget(current: AppThemeId, lastToggle: ThemeToggle | null): AppThemeId {
    if (lastToggle && lastToggle.to === current && isLightTheme(lastToggle.from) !== isLightTheme(current)) return lastToggle.from
    return THEME_TWINS[current] ?? (isLightTheme(current) ? SYSTEM_DARK_THEME : SYSTEM_LIGHT_THEME)
}
