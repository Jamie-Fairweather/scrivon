import { describe, expect, it, vi } from 'vitest'
import { buildWorkspaceCommands, type WorkspaceCommandsContext } from '@/components/studio/workspace/workspace-commands'

function context(overrides: Partial<WorkspaceCommandsContext> = {}): WorkspaceCommandsContext {
    return {
        isDesktop: true,
        workspaceRoot: '/ws',
        recentWorkspaces: [],
        pickAndOpenWorkspace: vi.fn(async () => {}),
        openWorkspace: vi.fn(async () => {}),
        closeWorkspace: vi.fn(async () => {}),
        refreshExplorer: vi.fn(async () => {}),
        ...overrides,
    }
}

const find = (ctx: WorkspaceCommandsContext, id: string) => buildWorkspaceCommands(ctx).find((command) => command.id === id)

describe('buildWorkspaceCommands', () => {
    it('opens and closes folders, and says why it cannot', () => {
        const ctx = context()
        find(ctx, 'open-folder')!.run()
        find(ctx, 'close-folder')!.run()
        expect(ctx.pickAndOpenWorkspace).toHaveBeenCalledTimes(1)
        expect(ctx.closeWorkspace).toHaveBeenCalledTimes(1)

        expect(find(context({ isDesktop: false }), 'open-folder')).toMatchObject({
            label: 'Open Folder…',
            disabled: true,
            disabledReason: 'Desktop only',
        })
        expect(find(context({ workspaceRoot: null }), 'close-folder')).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
    })

    it('reads the folder again with Refresh Explorer, and says why it is off with no folder open', () => {
        const ctx = context()
        const refresh = find(ctx, 'refresh-explorer')
        expect(refresh).toMatchObject({ label: 'Refresh Explorer', disabled: false })
        void refresh!.run()
        expect(ctx.refreshExplorer).toHaveBeenCalledTimes(1)

        expect(find(context({ workspaceRoot: null }), 'refresh-explorer')).toMatchObject({ disabled: true, disabledReason: 'Open a folder first' })
    })

    it('shows the full path of each recent folder, so two folders with the same name differ', () => {
        const recent = buildWorkspaceCommands(context({ recentWorkspaces: ['C:\\work\\docs', 'D:\\notes\\docs'] })).filter((c) =>
            c.id.startsWith('recent-workspace:')
        )
        expect(recent.map((c) => [c.label, c.detail])).toEqual([
            ['Open Recent Folder: docs', 'C:\\work\\docs'],
            ['Open Recent Folder: docs', 'D:\\notes\\docs'],
        ])
    })

    it('marks the recent folder that is open now, and opens the one picked', () => {
        const ctx = context({ workspaceRoot: 'C:\\work\\docs', recentWorkspaces: ['c:\\work\\docs\\', 'D:\\notes'] })
        const recent = buildWorkspaceCommands(ctx).filter((c) => c.id.startsWith('recent-workspace:'))
        expect(recent.map((c) => c.detail)).toEqual(['Current folder · c:\\work\\docs\\', 'D:\\notes'])

        void recent[1]!.run()
        expect(ctx.openWorkspace).toHaveBeenCalledWith('D:\\notes')
    })
})
