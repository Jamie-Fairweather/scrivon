import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'
import { getBaseName } from '@/lib/tauri/fs'
import type { KeybindBindings } from '@/lib/settings/types'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

export type CommandRegistryContext = {
    isDesktop: boolean
    workspaceRoot: string | null
    recentWorkspaces: string[]
    activeTabId: string | null
    hasDirtyTabs: boolean
    autosaveEnabled: boolean
    explorerOpen: boolean
    editorOpen: boolean
    keybinds: KeybindBindings
    pickAndOpenWorkspace: () => Promise<void>
    openWorkspace: (path: string) => Promise<void>
    closeWorkspace: () => Promise<void>
    flushSave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    setAutosaveEnabled: (enabled: boolean) => void
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setPreviewOnly: () => void
    requestCanvasFit: () => void
    closeTab: (id: string) => Promise<void>
    closeOtherTabs: (keepId: string) => Promise<void>
    closeAllTabs: () => Promise<void>
    openExample: (exampleId: string) => void
    openSettings: () => void
    isLight: boolean
    toggleLightDark: () => void
}

function shortcut(actionId: Parameters<typeof formatKeybindForAction>[0], keybinds: KeybindBindings): string | undefined {
    return formatKeybindForAction(actionId, keybinds)
}

export function buildCommandRegistry(ctx: CommandRegistryContext): ActionPaletteItem[] {
    const hasWorkspace = Boolean(ctx.workspaceRoot)
    const hasActiveTab = Boolean(ctx.activeTabId)
    const hasWorkspaceTab = hasActiveTab && ctx.activeTabId !== null && !isExampleTabId(ctx.activeTabId)

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
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
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
            disabled: !hasActiveTab,
            disabledReason: 'No tab open',
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
            run: () => ctx.openExample(example.id),
        })
    }

    for (const path of ctx.recentWorkspaces) {
        actions.push({
            kind: 'action',
            value: `action:recent-workspace:${path}`,
            searchText: `recent workspace ${getBaseName(path)} ${path}`,
            label: `Open Recent Folder: ${getBaseName(path)}`,
            disabled: !ctx.isDesktop,
            disabledReason: 'Desktop only',
            run: () => void ctx.openWorkspace(path),
        })
    }

    return actions
}

export function createToggleLightDark(isLight: boolean, setThemeId: (id: typeof SYSTEM_LIGHT_THEME | typeof SYSTEM_DARK_THEME) => void): () => void {
    return () => setThemeId(isLight ? SYSTEM_DARK_THEME : SYSTEM_LIGHT_THEME)
}
