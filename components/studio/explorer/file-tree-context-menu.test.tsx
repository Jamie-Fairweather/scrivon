import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPath, revealInFileExplorer } from '@/lib/workspace/path-actions'
import type { FileNode } from '@/lib/workspace/types'
import { FileTreeContextMenu, FileTreeRowContextMenu } from './file-tree-context-menu'

const ROOT = 'C:\\Work\\notes'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({
        workspaceRoot: ROOT,
        openFile: vi.fn(),
        duplicateFile: vi.fn(),
        createFile: vi.fn(),
        createFolder: vi.fn(),
        suggestName: vi.fn(),
        getNameError: vi.fn(),
    }),
}))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete: vi.fn() }) }))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName: vi.fn() }) }))
vi.mock('@/lib/workspace/path-actions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/workspace/path-actions')>()),
    revealInFileExplorer: vi.fn(async () => undefined),
    copyPath: vi.fn(async () => undefined),
}))

const file: FileNode = { kind: 'file', name: 'plan.md', path: `${ROOT}\\docs\\plan.md` }
const folder: FileNode = { kind: 'directory', name: 'docs', path: `${ROOT}\\docs`, children: [file] }

function renderRow(node: FileNode) {
    render(
        <FileTreeRowContextMenu node={node}>
            <div role="treeitem" aria-selected={false} tabIndex={0}>
                {node.name}
            </div>
        </FileTreeRowContextMenu>
    )
}

async function chooseFromRowMenu(name: string, menuItem: string) {
    fireEvent.contextMenu(screen.getByRole('treeitem', { name }), { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByRole('menuitem', { name: menuItem }))
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('FileTreeRowContextMenu', () => {
    it('reveals a file in File Explorer and copies its full or relative path', async () => {
        renderRow(file)

        await chooseFromRowMenu('plan.md', 'Reveal in File Explorer')
        expect(revealInFileExplorer).toHaveBeenCalledWith(file.path, ROOT)

        await chooseFromRowMenu('plan.md', 'Copy Path')
        expect(copyPath).toHaveBeenLastCalledWith(file.path)

        await chooseFromRowMenu('plan.md', 'Copy Relative Path')
        expect(copyPath).toHaveBeenLastCalledWith('docs\\plan.md', 'relative')
    })

    it('does the same for a folder', async () => {
        renderRow(folder)

        await chooseFromRowMenu('docs', 'Reveal in File Explorer')
        expect(revealInFileExplorer).toHaveBeenCalledWith(folder.path, ROOT)

        await chooseFromRowMenu('docs', 'Copy Relative Path')
        expect(copyPath).toHaveBeenLastCalledWith('docs', 'relative')
    })
})

describe('FileTreeContextMenu', () => {
    it("offers the same path items from the row's ... button", async () => {
        render(<FileTreeContextMenu node={file} rowRef={createRef()} />)

        fireEvent.click(screen.getByLabelText('Actions for plan.md'))
        const menu = await screen.findByRole('menu')
        for (const name of ['Reveal in File Explorer', 'Copy Path', 'Copy Relative Path']) {
            expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument()
        }
    })
})
