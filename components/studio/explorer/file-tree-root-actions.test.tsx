import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { FileTreeRootActions } from './file-tree-root-actions'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: vi.fn() }))
vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({
    useFileTreeActions: () => ({ createMermaidFileInParent: vi.fn(), createMarkdownFileInParent: vi.fn(), createFolderInParent: vi.fn() }),
}))

describe('FileTreeRootActions', () => {
    it('reads the folder again from the Refresh button, and shows it is busy until that finishes', async () => {
        let finish = () => {}
        const refreshTree = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
        vi.mocked(useWorkspaceSession).mockReturnValue({ workspaceRoot: 'C:\\work', refreshTree } as unknown as ReturnType<
            typeof useWorkspaceSession
        >)

        render(<FileTreeRootActions />)
        const button = screen.getByRole('button', { name: 'Refresh file list' })
        await userEvent.setup().click(button)

        expect(refreshTree).toHaveBeenCalledTimes(1)
        expect(button).toHaveAttribute('aria-busy', 'true')
        await act(async () => finish())
        expect(button).not.toHaveAttribute('aria-busy')
    })
})
