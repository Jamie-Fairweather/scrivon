import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirmProvider } from '@/components/studio/dialogs/delete-confirm-provider'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import type { FileNode } from '@/lib/workspace/types'
import { FileTree } from './file-tree'

// Where keyboard focus ends up around the tree's menus and dialogs, with the real dialogs (not mocked).

const { tabs, session } = vi.hoisted(() => ({
    tabs: { activeTabId: null as string | null, openFile: vi.fn(async () => undefined) },
    session: {
        openFile: vi.fn(async () => undefined),
        renameEntry: vi.fn<(oldPath: string, newName: string, isDirectory: boolean) => Promise<void>>(async () => undefined),
        deleteEntry: vi.fn<(path: string, isDirectory: boolean) => Promise<void>>(async () => undefined),
        duplicateFile: vi.fn(async () => undefined),
        createFile: vi.fn(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        suggestName: vi.fn((_parent: string, name: string) => name),
        getNameError: vi.fn(() => null),
    },
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => tabs,
    useWorkspaceSession: () => session,
}))

beforeAll(() => {
    // happy-dom has no Web Animations API; Base UI popups ask for running animations.
    Element.prototype.getAnimations ??= () => []
})

const file = (name: string): FileNode => ({ kind: 'file', name, path: `/ws/${name}` })
const tree: FileNode[] = [file('a.md'), file('b.md'), file('c.md')]

function ui(nodes: FileNode[]) {
    return (
        <NamePromptProvider>
            <DeleteConfirmProvider>
                <button type="button">Elsewhere</button>
                <FileTree tree={nodes} />
            </DeleteConfirmProvider>
        </NamePromptProvider>
    )
}

/** Renders the tree; renames and deletes show up in it the way a reload of the folder would. */
function renderTree() {
    let nodes = tree
    const view = render(ui(nodes))
    session.renameEntry.mockImplementation(async (oldPath, newName) => {
        nodes = nodes.map((node) => (node.path === oldPath ? file(newName) : node))
        view.rerender(ui(nodes))
    })
    session.deleteEntry.mockImplementation(async (path) => {
        nodes = nodes.filter((node) => node.path !== path)
        view.rerender(ui(nodes))
    })
}

const item = (name: string) => screen.getByRole('treeitem', { name })

/** Lets popups finish opening or closing: they wait an animation frame before they mount or unmount. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

async function renameTo(newName: string) {
    await settle()
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: newName } })
    fireEvent.submit(input.closest('form')!)
    await settle()
}

async function confirmDelete() {
    await settle()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await settle()
}

describe('FileTree focus', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("keeps focus in the name prompt opened from a row's '...' menu", async () => {
        renderTree()

        fireEvent.click(screen.getByLabelText('Actions for b.md'))
        const menu = await screen.findByRole('menu')
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
        await settle()

        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(screen.getByLabelText('Name')).toHaveFocus()
    })

    it("keeps focus in the delete confirmation opened from a row's '...' menu, then returns it to the row on cancel", async () => {
        renderTree()

        fireEvent.click(screen.getByLabelText('Actions for b.md'))
        fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
        await settle()
        const confirm = screen.getByRole('alertdialog')
        expect(confirm).toContainElement(document.activeElement as HTMLElement)

        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
        await settle()
        expect(session.deleteEntry).not.toHaveBeenCalled()
        expect(item('b.md')).toHaveFocus()
    })

    it("puts focus back on the row when its '...' menu is closed with Escape", async () => {
        renderTree()

        fireEvent.click(screen.getByLabelText('Actions for b.md'))
        const menu = await screen.findByRole('menu')
        fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'Escape' })
        await settle()

        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(item('b.md')).toHaveFocus()
    })

    it('moves focus to the renamed row after F2', async () => {
        renderTree()
        item('b.md').focus()

        fireEvent.keyDown(item('b.md'), { key: 'F2' })
        await renameTo('renamed.md')

        expect(session.renameEntry).toHaveBeenCalledWith('/ws/b.md', 'renamed.md', false)
        expect(item('renamed.md')).toHaveFocus()
        expect(item('renamed.md').tabIndex).toBe(0)
    })

    it('puts focus back on the row when the rename is cancelled', async () => {
        renderTree()
        item('b.md').focus()

        fireEvent.keyDown(item('b.md'), { key: 'F2' })
        await settle()
        fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' })
        await settle()

        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
        expect(item('b.md')).toHaveFocus()
    })

    it('moves focus to the row that took the place of a deleted one, or the one above at the end', async () => {
        renderTree()
        item('b.md').focus()

        fireEvent.keyDown(item('b.md'), { key: 'Delete' })
        await confirmDelete()
        expect(session.deleteEntry).toHaveBeenCalledWith('/ws/b.md', false)
        expect(item('c.md')).toHaveFocus()

        fireEvent.keyDown(item('c.md'), { key: 'Delete' })
        await confirmDelete()
        expect(item('a.md')).toHaveFocus()
    })

    it('moves focus to the renamed row when Rename is chosen from the row menu', async () => {
        renderTree()
        item('b.md').focus()

        fireEvent.keyDown(item('b.md'), { key: 'F10', shiftKey: true })
        fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }))
        await renameTo('renamed.md')

        expect(item('renamed.md')).toHaveFocus()
    })

    it('leaves focus alone when the user has moved on by the time the delete is done', async () => {
        renderTree()
        const deleteEntry = session.deleteEntry.getMockImplementation()!
        session.deleteEntry.mockImplementation(async (path, isDirectory) => {
            screen.getByRole('button', { name: 'Elsewhere' }).focus()
            await deleteEntry(path, isDirectory)
        })
        item('b.md').focus()

        fireEvent.keyDown(item('b.md'), { key: 'Delete' })
        await confirmDelete()

        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
        // Tab still comes back to where the user was in the tree.
        expect(item('c.md').tabIndex).toBe(0)
    })
})
