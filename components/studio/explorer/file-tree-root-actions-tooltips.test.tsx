import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FileTreeRootActions } from './file-tree-root-actions'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: 'C:\\work', refreshTree: async () => {} }),
}))
vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({
    useFileTreeActions: () => ({ createMermaidFileInParent: vi.fn(), createMarkdownFileInParent: vi.fn(), createFolderInParent: vi.fn() }),
}))

beforeAll(() => {
    // happy-dom has no Web Animations API; Base UI menus ask for running animations.
    Element.prototype.getAnimations ??= () => []
})

describe('FileTreeRootActions tooltips', () => {
    it('labels Refresh in a tooltip that shows on keyboard focus, not a title', async () => {
        render(<FileTreeRootActions />)
        const refresh = screen.getByRole('button', { name: 'Refresh file list' })
        expect(refresh).not.toHaveAttribute('title')

        act(() => refresh.focus())
        expect(await screen.findByText('Refresh file list')).toBeInTheDocument()
    })

    it('labels the New menu in a tooltip, and the button still opens its menu by click and by Enter', async () => {
        const user = userEvent.setup()
        render(<FileTreeRootActions />)
        const newButton = screen.getByRole('button', { name: 'New file or folder' })
        expect(newButton).not.toHaveAttribute('title')

        act(() => newButton.focus())
        expect(await screen.findByText('New file or folder')).toBeInTheDocument()

        await user.keyboard('{Enter}')
        expect(await screen.findByRole('menuitem', { name: 'New Diagram (.mmd)' })).toBeInTheDocument()

        await user.keyboard('{Escape}')
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()

        fireEvent.click(newButton)
        expect(await screen.findByRole('menuitem', { name: 'New Folder' })).toBeInTheDocument()
    })
})
