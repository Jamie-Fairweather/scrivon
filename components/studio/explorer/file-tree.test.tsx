import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { FileTree } from './file-tree'

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

const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [{ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' }],
    },
    { kind: 'file', name: 'flow.mmd', path: '/ws/flow.mmd' },
    { kind: 'file', name: 'photo.png', path: '/ws/photo.png' },
]

const item = (name: string) => screen.getByRole('treeitem', { name })
const press = (name: string, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(item(name), { key, ...init })

async function chooseFromActionsMenu(name: string, menuItem: string) {
    fireEvent.click(screen.getByLabelText(`Actions for ${name}`))
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: menuItem }))
}

describe('FileTree', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        tabs.activeTabId = null
    })

    it('exposes a tree with levels, open state and the open file', () => {
        tabs.activeTabId = '/ws/flow.mmd'
        render(<FileTree tree={tree} />)

        expect(screen.getByRole('tree', { name: 'Files' })).toBeInTheDocument()
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
        expect(item('docs')).toHaveAttribute('aria-level', '1')
        expect(item('notes.md')).toHaveAttribute('aria-level', '2')
        expect(item('notes.md')).not.toHaveAttribute('aria-expanded')
        expect(item('flow.mmd')).toHaveAttribute('aria-selected', 'true')
        expect(item('photo.png')).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows the full name on hover, and why an unsupported file will not open', () => {
        render(<FileTree tree={tree} />)

        expect(item('flow.mmd')).toHaveAttribute('title', 'flow.mmd')
        expect(item('photo.png')).toHaveAttribute('title', 'photo.png\nScrivon supports .md, .mmd and .mermaid files only')
    })

    it('is a single Tab stop, on the open file', () => {
        tabs.activeTabId = '/ws/flow.mmd'
        render(<FileTree tree={tree} />)

        const tabbable = screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)
        expect(tabbable).toEqual([item('flow.mmd')])
        expect(screen.getByLabelText('Actions for flow.mmd')).toHaveAttribute('tabindex', '-1')
    })

    it('moves focus with the arrow keys, Home and End, and the Tab stop follows', () => {
        render(<FileTree tree={tree} />)
        item('docs').focus()

        press('docs', 'ArrowDown')
        expect(item('notes.md')).toHaveFocus()
        expect(item('notes.md').tabIndex).toBe(0)
        expect(item('docs').tabIndex).toBe(-1)

        press('notes.md', 'End')
        expect(item('photo.png')).toHaveFocus()
        press('photo.png', 'Home')
        expect(item('docs')).toHaveFocus()
        press('notes.md', 'ArrowLeft')
        expect(item('docs')).toHaveFocus()
    })

    it('closes and opens folders with Left and Right, and with Enter', () => {
        render(<FileTree tree={tree} />)

        press('docs', 'ArrowLeft')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('treeitem', { name: 'notes.md' })).not.toBeInTheDocument()

        press('docs', 'ArrowRight')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')

        press('docs', 'Enter')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens a supported file with Enter or a click, and ignores unsupported ones', () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'Enter')
        fireEvent.click(item('notes.md'))
        press('photo.png', 'Enter')

        expect(tabs.openFile).toHaveBeenCalledTimes(2)
        expect(tabs.openFile).toHaveBeenNthCalledWith(1, '/ws/flow.mmd')
        expect(tabs.openFile).toHaveBeenNthCalledWith(2, '/ws/docs/notes.md')
    })

    it('renames with F2 and deletes with Delete', () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'F2')
        expect(promptName).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Rename "flow.mmd"',
                description: 'Choose a new name for this file.',
                submitLabel: 'Rename',
                defaultValue: 'flow.mmd',
            })
        )

        press('docs', 'Delete')
        expect(confirmDelete).toHaveBeenCalledWith('docs', true)
    })

    it('opens the row menu with Shift+F10 or the menu key', async () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'F10', { shiftKey: true })
        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    })

    it('ignores keys typed inside an open row menu', async () => {
        render(<FileTree tree={tree} />)
        press('docs', 'ContextMenu')
        const menu = await screen.findByRole('menu')

        fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'ArrowLeft' })

        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
    })

    it('does not collapse a folder when an item in its actions menu is chosen', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('docs', 'New Folder')

        expect(promptName).toHaveBeenCalledTimes(1)
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
    })

    it('does not open a file when Delete is chosen from its actions menu', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('notes.md', 'Delete')

        expect(confirmDelete).toHaveBeenCalledWith('notes.md', false)
        expect(tabs.openFile).not.toHaveBeenCalled()
        expect(session.openFile).not.toHaveBeenCalled()
    })

    it('opens a file once when Open is chosen from its actions menu', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('notes.md', 'Open')

        expect(session.openFile).toHaveBeenCalledTimes(1)
        expect(tabs.openFile).not.toHaveBeenCalled()
    })

    it('keeps the actions button out of the row, so the row is named after the entry only', () => {
        render(<FileTree tree={tree} />)

        expect(item('flow.mmd')).not.toContainElement(screen.getByLabelText('Actions for flow.mmd'))
    })
})
