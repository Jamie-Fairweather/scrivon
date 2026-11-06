import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { FileTreeNode } from './file-tree-node'

const { tabs, session, confirmDelete, promptName } = vi.hoisted(() => ({
    tabs: { activeTabId: null as string | null, openFile: vi.fn(async () => undefined) },
    session: {
        openFile: vi.fn(async () => undefined),
        renameEntry: vi.fn(async () => undefined),
        deleteEntry: vi.fn(async () => undefined),
        duplicateFile: vi.fn(async () => undefined),
        createFile: vi.fn(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        suggestName: vi.fn((_parent: string, name: string) => name),
        getNameError: vi.fn(() => null),
    },
    confirmDelete: vi.fn(async () => false),
    promptName: vi.fn(async () => null),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => tabs,
    useWorkspaceSession: () => session,
}))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete }) }))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))

beforeAll(() => {
    // happy-dom has no Web Animations API; Base UI menus ask for running animations.
    Element.prototype.getAnimations ??= () => []
})

const docs: FileNode = {
    kind: 'directory',
    name: 'docs',
    path: '/ws/docs',
    children: [{ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' }],
}

async function chooseFromActionsMenu(name: string, item: string) {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: item }))
}

describe('FileTreeNode', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('keeps the actions button out of the row button, named after the entry', () => {
        render(<FileTreeNode node={docs} />)

        const row = screen.getByRole('button', { name: 'notes.md' })
        const actions = screen.getByRole('button', { name: 'Actions for notes.md' })
        expect(row).not.toContainElement(actions)
    })

    it('does not collapse a folder when an item in its actions menu is chosen', async () => {
        render(<FileTreeNode node={docs} />)

        await chooseFromActionsMenu('docs', 'New Folder')

        expect(promptName).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: 'notes.md' })).toBeInTheDocument()
    })

    it('does not open a file when Delete is chosen from its actions menu', async () => {
        render(<FileTreeNode node={docs} />)

        await chooseFromActionsMenu('notes.md', 'Delete')

        expect(confirmDelete).toHaveBeenCalledWith('notes.md', false)
        expect(tabs.openFile).not.toHaveBeenCalled()
        expect(session.openFile).not.toHaveBeenCalled()
    })

    it('opens a file once when Open is chosen from its actions menu', async () => {
        render(<FileTreeNode node={docs} />)

        await chooseFromActionsMenu('notes.md', 'Open')

        expect(session.openFile).toHaveBeenCalledTimes(1)
        expect(tabs.openFile).not.toHaveBeenCalled()
    })

    it('opens a file and toggles a folder from the row itself', () => {
        render(<FileTreeNode node={docs} />)

        fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
        expect(tabs.openFile).toHaveBeenCalledWith('/ws/docs/notes.md')

        fireEvent.click(screen.getByRole('button', { name: 'docs' }))
        expect(screen.queryByRole('button', { name: 'notes.md' })).not.toBeInTheDocument()
    })
})
