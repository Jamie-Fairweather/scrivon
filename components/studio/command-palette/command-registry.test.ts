import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { APP_THEME_IDS, isLightTheme, type AppThemeId } from '@/lib/theme/catalog'
import {
    buildCommandRegistry,
    THEME_TWINS,
    themeToggleTarget,
    type CommandRegistryContext,
} from '@/components/studio/command-palette/command-registry'

function context(overrides: Partial<CommandRegistryContext> = {}): CommandRegistryContext {
    return {
        isDesktop: true,
        workspaceRoot: '/ws',
        recentWorkspaces: [],
        activeTabId: '/ws/a.md',
        hasDirtyTabs: false,
        autosaveEnabled: true,
        explorerOpen: true,
        editorOpen: true,
        keybinds: createDefaultSettings(false).keybinds,
        pickAndOpenWorkspace: vi.fn(async () => {}),
        openWorkspace: vi.fn(async () => {}),
        closeWorkspace: vi.fn(async () => {}),
        flushSave: vi.fn(async () => true),
        flushAllSaves: vi.fn(async () => true),
        setAutosaveEnabled: vi.fn(),
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOnly: vi.fn(),
        requestCanvasFit: vi.fn(),
        closeTab: vi.fn(async () => {}),
        closeOtherTabs: vi.fn(async () => {}),
        closeAllTabs: vi.fn(async () => {}),
        openExample: vi.fn(),
        openSettings: vi.fn(),
        isLight: true,
        toggleLightDark: vi.fn(),
        ...overrides,
    }
}

function byValue(ctx: CommandRegistryContext, prefix: string) {
    return buildCommandRegistry(ctx).filter((action) => action.value.startsWith(prefix))
}

describe('themeToggleTarget', () => {
    it("switches to the same family's light or dark version", () => {
        expect(themeToggleTarget('nord', null)).toBe('nord-light')
        expect(themeToggleTarget('nord-light', null)).toBe('nord')
        expect(themeToggleTarget('catppuccin-mocha', null)).toBe('catppuccin-latte')
    })

    it('goes back to the theme the last switch came from', () => {
        expect(themeToggleTarget('tokyo-night-storm', null)).toBe('tokyo-night-light')
        expect(themeToggleTarget('tokyo-night-light', { from: 'tokyo-night-storm', to: 'tokyo-night-light' })).toBe('tokyo-night-storm')
        expect(themeToggleTarget('scrivon-light', { from: 'dracula', to: 'scrivon-light' })).toBe('dracula')
    })

    it('falls back to Scrivon for themes with no twin', () => {
        expect(themeToggleTarget('dracula', null)).toBe('scrivon-light')
        expect(themeToggleTarget('one-dark', null)).toBe('scrivon-light')
    })

    it('ignores a last switch the user has since moved away from', () => {
        expect(themeToggleTarget('github-light', { from: 'dracula', to: 'scrivon-light' })).toBe('github-dark')
    })

    it('only pairs real themes of the opposite kind', () => {
        for (const [id, twin] of Object.entries(THEME_TWINS) as Array<[AppThemeId, AppThemeId]>) {
            expect(APP_THEME_IDS).toContain(id)
            expect(APP_THEME_IDS).toContain(twin)
            expect(isLightTheme(twin)).toBe(!isLightTheme(id))
        }
    })
})

describe('buildCommandRegistry recent folders', () => {
    it('shows the full path of each recent folder, so two folders with the same name differ', () => {
        const recent = byValue(context({ recentWorkspaces: ['C:\\work\\docs', 'D:\\notes\\docs'] }), 'action:recent-workspace:')
        expect(recent.map((action) => [action.label, action.detail])).toEqual([
            ['Open Recent Folder: docs', 'C:\\work\\docs'],
            ['Open Recent Folder: docs', 'D:\\notes\\docs'],
        ])
    })
})

describe('buildCommandRegistry examples', () => {
    it('disables Open Example with a reason when no folder is open', () => {
        const examples = byValue(context({ workspaceRoot: null, activeTabId: null }), 'action:example:')
        expect(examples.length).toBeGreaterThan(0)
        expect(examples.every((action) => action.disabled && action.disabledReason === 'Open a folder first')).toBe(true)
    })

    it('enables Open Example when a folder is open', () => {
        const examples = byValue(context(), 'action:example:')
        expect(examples.every((action) => !action.disabled)).toBe(true)
    })

    it('disables the tab commands when a hidden tab is left over with no folder open', () => {
        const ctx = context({ workspaceRoot: null, activeTabId: 'example:flowchart' })
        for (const value of ['action:close-tab', 'action:close-other-tabs', 'action:close-all-tabs']) {
            expect(byValue(ctx, value)[0]?.disabled).toBe(true)
        }
    })
})
