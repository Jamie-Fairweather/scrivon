import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { buildCommandRegistry, type CommandRegistryContext } from '@/components/studio/command-palette/command-registry'

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
