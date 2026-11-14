import { describe, expect, it, vi } from 'vitest'
import { buildExplorerCommands, type ExplorerCommandsContext } from '@/components/studio/explorer/explorer-commands'

function context(overrides: Partial<ExplorerCommandsContext> = {}): ExplorerCommandsContext {
    return {
        hasWorkspace: true,
        canRevealActiveFile: true,
        collapseAllFolders: vi.fn(),
        revealActiveFile: vi.fn(),
        ...overrides,
    }
}

const find = (ctx: ExplorerCommandsContext, id: string) => buildExplorerCommands(ctx).find((command) => command.id === id)

describe('buildExplorerCommands', () => {
    it('collapses every folder in the explorer', () => {
        const ctx = context()
        expect(find(ctx, 'collapse-all-folders')).toMatchObject({ label: 'Collapse All Folders', disabled: false })

        void find(ctx, 'collapse-all-folders')!.run()
        expect(ctx.collapseAllFolders).toHaveBeenCalledTimes(1)
    })

    it('shows the open file in the explorer', () => {
        const ctx = context()
        expect(find(ctx, 'reveal-active-file')).toMatchObject({ label: 'Reveal Active File in Explorer', disabled: false })

        void find(ctx, 'reveal-active-file')!.run()
        expect(ctx.revealActiveFile).toHaveBeenCalledTimes(1)
    })

    it('can be found by the words people use for them', () => {
        expect(find(context(), 'collapse-all-folders')?.keywords).toContain('explorer')
        expect(find(context(), 'reveal-active-file')?.keywords).toMatch(/\bshow\b.*\bcurrent\b/)
    })

    it('says why they are off with no folder open', () => {
        const ctx = context({ hasWorkspace: false, canRevealActiveFile: false })
        expect(find(ctx, 'collapse-all-folders')).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        expect(find(ctx, 'reveal-active-file')).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
    })

    it('says why Reveal is off when the open tab is not a file in the folder', () => {
        const ctx = context({ canRevealActiveFile: false })
        expect(find(ctx, 'collapse-all-folders')?.disabled).toBe(false)
        expect(find(ctx, 'reveal-active-file')).toMatchObject({ disabled: true, disabledReason: 'No file from the folder is open' })
    })
})
