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
        renameEntry: vi.fn(async (_oldPath: string, _newName: string, _isDirectory: boolean) => undefined),
        deleteEntry: vi.fn(async (_path: string, _isDirectory: boolean) => undefined),
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

const tree: FileNode[] = [
    { kind: 'file', name: 'a.md', path: '/ws/a.md' },
    { kind: 'file', name: 'b.md', path: '/ws/b.md' },
    { kind: 'file', name: 'c.md', path: '/ws/c.md' },
]

function renderTree(nodes: FileNode[] = tree) {
    return render(
        <NamePromptProvider>
            <DeleteConfirmProvider>
                <FileTree tree={nodes} />
            </DeleteConfirmProvider>
        </NamePromptProvider>
    )
}

const item = (name: string) => screen.getByRole('treeitem', { name })

/** Lets popups finish opening or closing: they wait an animation frame before they mount or unmount. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

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

    it("puts focus back on the row when its '...' menu is closed with Escape", async () => {
        renderTree()

        fireEvent.click(screen.getByLabelText('Actions for b.md'))
        const menu = await screen.findByRole('menu')
        fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'Escape' })
        await settle()

        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(item('b.md')).toHaveFocus()
    })
})
