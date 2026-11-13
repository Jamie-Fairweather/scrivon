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
        tabCount: 2,
        hasDirtyTabs: false,
        autosaveEnabled: true,
        explorerOpen: true,
        editorOpen: true,
        outlineOpen: false,
        canFitDiagram: true,
        keybinds: createDefaultSettings(false).keybinds,
        pickAndOpenWorkspace: vi.fn(async () => {}),
        openWorkspace: vi.fn(async () => {}),
        closeWorkspace: vi.fn(async () => {}),
        refreshTree: vi.fn(async () => {}),
        flushSave: vi.fn(async () => true),
        flushAllSaves: vi.fn(async () => true),
        setAutosaveEnabled: vi.fn(),
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setOutlineOpen: vi.fn(),
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

    it('marks the folder that is open now', () => {
        const recent = byValue(
            context({ workspaceRoot: 'C:\\work\\docs', recentWorkspaces: ['c:\\work\\docs\\', 'D:\\notes'] }),
            'action:recent-workspace:'
        )
        expect(recent.map((action) => action.detail)).toEqual(['Current folder · c:\\work\\docs\\', 'D:\\notes'])
    })
})

describe('buildCommandRegistry Refresh Explorer', () => {
    it('reads the folder again', () => {
        const ctx = context()
        const [refresh] = byValue(ctx, 'action:refresh-explorer')
        expect(refresh).toMatchObject({ label: 'Refresh Explorer', disabled: false })
        void refresh!.run()
        expect(ctx.refreshTree).toHaveBeenCalledTimes(1)
    })

    it('says why it is off when no folder is open', () => {
        const [refresh] = byValue(context({ workspaceRoot: null, activeTabId: null }), 'action:refresh-explorer')
        expect(refresh).toMatchObject({ disabled: true, disabledReason: 'Open a folder first' })
    })
})

describe('buildCommandRegistry Outline', () => {
    it('shows and hides the Outline panel', () => {
        const closed = context({ outlineOpen: false })
        const [show] = byValue(closed, 'action:toggle-outline')
        expect(show).toMatchObject({ label: 'Show Outline', disabled: false })
        void show!.run()
        expect(closed.setOutlineOpen).toHaveBeenCalledWith(true)

        const open = context({ outlineOpen: true })
        const [hide] = byValue(open, 'action:toggle-outline')
        expect(hide).toMatchObject({ label: 'Hide Outline' })
        void hide!.run()
        expect(open.setOutlineOpen).toHaveBeenCalledWith(false)
    })

    it('is off with no folder open, as the panel only shows with one', () => {
        expect(byValue(context({ workspaceRoot: null, activeTabId: null }), 'action:toggle-outline')[0]).toMatchObject({
            disabled: true,
            disabledReason: 'No folder open',
        })
    })
})

describe('buildCommandRegistry commands that would do nothing', () => {
    it('turns off Close Other Tabs with only one tab open, and says why', () => {
        expect(byValue(context({ tabCount: 1 }), 'action:close-other-tabs')[0]).toMatchObject({ disabled: true, disabledReason: 'Only one tab open' })
        expect(byValue(context({ tabCount: 0, activeTabId: null }), 'action:close-other-tabs')[0]).toMatchObject({
            disabled: true,
            disabledReason: 'No tab open',
        })
        expect(byValue(context({ tabCount: 2 }), 'action:close-other-tabs')[0]?.disabled).toBe(false)
    })

    it('turns off Fit Diagram to Screen when no diagram is drawn, and says why', () => {
        expect(byValue(context({ canFitDiagram: false }), 'action:fit-diagram')[0]).toMatchObject({
            disabled: true,
            disabledReason: 'No diagram to fit',
        })
        expect(byValue(context({ workspaceRoot: null, canFitDiagram: false }), 'action:fit-diagram')[0]).toMatchObject({
            disabled: true,
            disabledReason: 'No folder open',
        })
        expect(byValue(context({ canFitDiagram: true }), 'action:fit-diagram')[0]?.disabled).toBe(false)
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
