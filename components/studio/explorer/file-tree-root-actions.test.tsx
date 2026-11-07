import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { FileTreeRootActions } from './file-tree-root-actions'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: vi.fn(), useWorkspaceCoordinator: vi.fn() }))
vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({
    useFileTreeActions: () => ({ createMermaidFileInParent: vi.fn(), createMarkdownFileInParent: vi.fn(), createFolderInParent: vi.fn() }),
}))

const reloadChangedTabs = vi.fn<() => Promise<void>>()

function mockFolder(refreshTree: () => Promise<void>) {
    vi.mocked(useWorkspaceSession).mockReturnValue({ workspaceRoot: 'C:\\work', refreshTree } as unknown as ReturnType<typeof useWorkspaceSession>)
}

beforeEach(() => {
    vi.clearAllMocks()
    const coordinator = createWorkspaceCoordinatorRefs()
    coordinator.reloadChangedTabs.current = reloadChangedTabs
    vi.mocked(useWorkspaceCoordinator).mockReturnValue(coordinator)
})

describe('FileTreeRootActions', () => {
    it('reads the folder and the open files with no edits again from Refresh, and shows it is busy until both finish', async () => {
        let finishTree = () => {}
        let finishTabs = () => {}
        const refreshTree = vi.fn(() => new Promise<void>((resolve) => (finishTree = resolve)))
        reloadChangedTabs.mockImplementation(() => new Promise<void>((resolve) => (finishTabs = resolve)))
        mockFolder(refreshTree)

        render(<FileTreeRootActions />)
        const button = screen.getByRole('button', { name: 'Refresh file list' })
        await userEvent.setup().click(button)

        expect(refreshTree).toHaveBeenCalledTimes(1)
        expect(reloadChangedTabs).toHaveBeenCalledTimes(1)
        expect(button).toHaveAttribute('aria-busy', 'true')
        await act(async () => finishTree())
        expect(button).toHaveAttribute('aria-busy', 'true')
        await act(async () => finishTabs())
        expect(button).not.toHaveAttribute('aria-busy')
    })

    it('stops showing it is busy when the open files could not be checked', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        reloadChangedTabs.mockRejectedValue(new Error('gone'))
        mockFolder(async () => {})

        render(<FileTreeRootActions />)
        const button = screen.getByRole('button', { name: 'Refresh file list' })
        await userEvent.setup().click(button)

        await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
        expect(warn).toHaveBeenCalledWith("Couldn't check the open files for changes", expect.any(Error))
        warn.mockRestore()
    })
})
