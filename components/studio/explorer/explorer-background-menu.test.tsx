import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerBackgroundMenu } from './explorer-background-menu'

const { promptName, session, coordinator } = vi.hoisted(() => ({
    promptName: vi.fn(async () => null),
    session: {
        workspaceRoot: 'C:\\ws',
        refreshTree: vi.fn(async () => {}),
        createFile: vi.fn(async () => {}),
        createFolder: vi.fn(async () => {}),
        suggestName: (_folder: string, name: string) => name,
        getNameError: () => null,
    },
    coordinator: { reloadChangedTabs: { current: vi.fn(async () => {}) } },
}))

vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useWorkspaceCoordinator: () => coordinator,
}))

function renderExplorer() {
    render(
        <ExplorerBackgroundMenu>
            <p>No files in this folder.</p>
            {/* Rows open their own menu and stop the right-click there. */}
            <div role="treeitem" aria-selected={false} onContextMenu={(e) => e.stopPropagation()}>
                notes.md
            </div>
        </ExplorerBackgroundMenu>
    )
}

describe('ExplorerBackgroundMenu', () => {
    beforeEach(() => vi.clearAllMocks())

    it('offers new items and Refresh on a right-click in empty space', async () => {
        renderExplorer()

        fireEvent.contextMenu(screen.getByText('No files in this folder.'))

        const menu = await screen.findByRole('menu')
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent)
        ).toEqual(['New Diagram…', 'New Document…', 'New Folder…', 'Refresh'])
    })

    it.each([
        ['New Diagram…', 'new-diagram'],
        ['New Document…', 'new-document'],
        ['New Folder…', 'new-folder'],
    ])('creates %s at the top of the open folder', async (name, kind) => {
        renderExplorer()
        fireEvent.contextMenu(screen.getByText('No files in this folder.'))

        await userEvent.setup().click(await screen.findByRole('menuitem', { name }))

        expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind, folder: 'C:\\ws' }))
    })

    it('leaves a right-click inside the open menu alone', async () => {
        renderExplorer()
        fireEvent.contextMenu(screen.getByText('No files in this folder.'))

        // Not taken: fireEvent returns false when the right-click is taken (its default stopped).
        expect(fireEvent.contextMenu(await screen.findByRole('menuitem', { name: 'Refresh' }))).toBe(true)
    })

    it('reads the folder and the open files again on Refresh', async () => {
        renderExplorer()
        fireEvent.contextMenu(screen.getByText('No files in this folder.'))

        await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Refresh' }))

        await waitFor(() => expect(session.refreshTree).toHaveBeenCalledTimes(1))
        expect(coordinator.reloadChangedTabs.current).toHaveBeenCalledTimes(1)
    })

    it("leaves a row's right-click to the row", () => {
        renderExplorer()

        fireEvent.contextMenu(screen.getByRole('treeitem'))

        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
})
