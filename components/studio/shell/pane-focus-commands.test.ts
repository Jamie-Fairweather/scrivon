import { describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { buildPaneFocusCommands, type PaneFocusCommandsContext } from '@/components/studio/shell/pane-focus-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

function context(overrides: Partial<PaneFocusCommandsContext> = {}): PaneFocusCommandsContext {
    return {
        hasWorkspace: true,
        hasOpenFile: true,
        explorerOpen: true,
        editorOpen: true,
        previewOpen: true,
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOpen: vi.fn(),
        focusPane: vi.fn(),
        cyclePaneFocus: vi.fn(),
        ...overrides,
    }
}

const find = (ctx: PaneFocusCommandsContext, id: string) => buildPaneFocusCommands(ctx).find((command) => command.id === id)!

describe('buildPaneFocusCommands', () => {
    it('lists the focus commands with their default keys', () => {
        const keybinds = createDefaultKeybinds(false)
        expect(buildPaneFocusCommands(context()).map((command) => [command.label, commandShortcut(command, keybinds, false)])).toEqual([
            ['Focus Explorer', 'Ctrl+Shift+E'],
            ['Focus Editor', 'Ctrl+1'],
            ['Focus Preview', 'Ctrl+2'],
            ['Focus Next Pane', 'F6'],
            ['Focus Previous Pane', 'Shift+F6'],
        ])
    })

    it('moves focus to the pane, or round the panes', () => {
        const ctx = context()
        void find(ctx, 'focus-explorer').run()
        void find(ctx, 'focus-editor').run()
        void find(ctx, 'focus-preview').run()
        void find(ctx, 'focus-next-pane').run()
        void find(ctx, 'focus-previous-pane').run()

        expect(vi.mocked(ctx.focusPane).mock.calls).toEqual([['explorer'], ['editor'], ['preview']])
        expect(vi.mocked(ctx.cyclePaneFocus).mock.calls).toEqual([[1], [-1]])
        expect(ctx.setExplorerOpen).not.toHaveBeenCalled()
        expect(ctx.setEditorOpen).not.toHaveBeenCalled()
        expect(ctx.setPreviewOpen).not.toHaveBeenCalled()
    })

    it('shows a hidden explorer, editor or preview before focusing it', () => {
        const ctx = context({ explorerOpen: false, editorOpen: false, previewOpen: false })
        void find(ctx, 'focus-explorer').run()
        void find(ctx, 'focus-editor').run()
        void find(ctx, 'focus-preview').run()

        expect(ctx.setExplorerOpen).toHaveBeenCalledWith(true)
        expect(ctx.setEditorOpen).toHaveBeenCalledWith(true)
        expect(ctx.setPreviewOpen).toHaveBeenCalledWith(true)
        expect(vi.mocked(ctx.focusPane).mock.calls).toEqual([['explorer'], ['editor'], ['preview']])
    })

    it('is off with no folder open, and Focus Editor with no file open', () => {
        for (const command of buildPaneFocusCommands(context({ hasWorkspace: false }))) {
            expect(command).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
        const noFile = buildPaneFocusCommands(context({ hasOpenFile: false }))
        expect(noFile.filter((command) => command.disabled).map((command) => [command.id, command.disabledReason])).toEqual([
            ['focus-editor', 'No file open'],
        ])
    })
})
