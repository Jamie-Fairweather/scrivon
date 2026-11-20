import { describe, expect, it, vi } from 'vitest'
import { buildGroupCommands, type GroupCommandsContext } from '@/components/studio/workspace/group-commands'
import { singleGroup, type EditorGroups } from '@/lib/workspace/editor-groups'

function context(groups: EditorGroups, overrides: Partial<GroupCommandsContext> = {}): GroupCommandsContext {
    return {
        hasWorkspace: true,
        groups,
        editorOpen: true,
        splitEditor: vi.fn(),
        moveTabToOtherGroup: vi.fn(),
        focusOtherGroup: vi.fn(),
        joinGroups: vi.fn(),
        focusGroupSoon: vi.fn(),
        ...overrides,
    }
}

const split: EditorGroups = {
    groups: [
        { id: 'group-1', tabIds: ['/w/a.md'], activeTabId: '/w/a.md' },
        { id: 'group-2', tabIds: ['/w/b.md'], activeTabId: '/w/b.md' },
    ],
    focused: 0,
    ratio: 0.5,
}

const find = (ctx: GroupCommandsContext, id: string) => buildGroupCommands(ctx).find((c) => c.id === id)!

describe('the editor group commands', () => {
    it('are Split Editor on Ctrl+\\, and Move Tab to Other Group, Focus Other Group and Join Groups, each with a shortcut to set', () => {
        expect(buildGroupCommands(context(split)).map((c) => [c.label, c.keybind])).toEqual([
            ['Split Editor', 'view.splitEditor'],
            ['Move Tab to Other Group', 'view.moveTabToOtherGroup'],
            ['Focus Other Group', 'view.focusOtherGroup'],
            ['Join Groups', 'view.joinGroups'],
        ])
    })

    it('say why they can’t run: no folder, no tab, one tab, or the editor not split', () => {
        const noFolder = context(split, { hasWorkspace: false })
        for (const id of ['split-editor', 'move-tab-to-other-group', 'focus-other-group', 'join-groups']) {
            expect(find(noFolder, id)).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
        const noTab = context(singleGroup())
        expect(find(noTab, 'split-editor')).toMatchObject({ disabled: true, disabledReason: 'No tab open' })
        expect(find(noTab, 'move-tab-to-other-group')).toMatchObject({ disabled: true, disabledReason: 'No tab open' })
        const oneTab = context(singleGroup(['/w/a.md'], '/w/a.md'))
        expect(find(oneTab, 'split-editor').disabled).toBe(false)
        expect(find(oneTab, 'move-tab-to-other-group')).toMatchObject({ disabled: true, disabledReason: 'Only one tab open' })
        expect(find(oneTab, 'focus-other-group')).toMatchObject({ disabled: true, disabledReason: 'The editor isn’t split' })
        expect(find(oneTab, 'join-groups')).toMatchObject({ disabled: true, disabledReason: 'The editor isn’t split' })
        expect(find(context(split), 'focus-other-group').disabled).toBe(false)
        expect(find(context(split), 'join-groups').disabled).toBe(false)
    })

    it('act on the focused group and move the keyboard there, waiting for a group being made', () => {
        const ctx = context(singleGroup(['/w/a.md', '/w/b.md'], '/w/b.md'))
        find(ctx, 'split-editor').run()
        expect(ctx.splitEditor).toHaveBeenCalledOnce()
        expect(ctx.focusGroupSoon).toHaveBeenLastCalledWith('/w/b.md', true)

        const splitCtx = context(split)
        find(splitCtx, 'move-tab-to-other-group').run()
        expect(splitCtx.moveTabToOtherGroup).toHaveBeenCalledOnce()
        expect(splitCtx.focusGroupSoon).toHaveBeenLastCalledWith('/w/a.md', false)
        find(splitCtx, 'focus-other-group').run()
        expect(splitCtx.focusOtherGroup).toHaveBeenCalledOnce()
        expect(splitCtx.focusGroupSoon).toHaveBeenLastCalledWith('/w/b.md', false)
        find(splitCtx, 'join-groups').run()
        expect(splitCtx.joinGroups).toHaveBeenCalledOnce()
    })
})
