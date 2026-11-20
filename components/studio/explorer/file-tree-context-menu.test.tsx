import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPath, revealInFileExplorer } from '@/lib/workspace/path-actions'
import type { FileNode } from '@/lib/workspace/types'
import { FileTreeContextMenu, FileTreeRowContextMenu } from './file-tree-context-menu'

const ROOT = 'C:\\Work\\notes'

const { chooseTemplate, promptName, createFile } = vi.hoisted(() => ({
    chooseTemplate: vi.fn(async () => ({ title: 'Meeting notes', fileName: 'meeting-notes.md', kind: 'markdown' as const, text: '# {{title}}\n' })),
    promptName: vi.fn(async (): Promise<string | null> => 'standup'),
    createFile: vi.fn(async () => {}),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({
        workspaceRoot: ROOT,
        openFile: vi.fn(),
        duplicateFile: vi.fn(),
        createFile,
        createFolder: vi.fn(),
        suggestName: (_folder: string, name: string) => name,
        getNameError: vi.fn(() => null),
    }),
}))
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete: vi.fn() }) }))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/dialogs/template-picker-provider', () => ({ useTemplatePicker: () => ({ chooseTemplate }) }))
vi.mock('@/components/studio/dialogs/move-to-provider', () => ({ useMoveTo: () => ({ chooseFolder: vi.fn() }) }))
/** The folder export, as BatchExportProvider gives it; null where there is none. */
const batch = vi.hoisted(() => ({
    current: null as null | { availability: { disabled: boolean; reason: string }; exportFolder: (folder: string) => void },
}))
vi.mock('@/components/studio/batch-export/batch-export-provider', () => ({ useBatchExport: () => batch.current }))
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
    batch.current = { availability: { disabled: false, reason: '' }, exportFolder: vi.fn() }
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

    it("offers New from Template… in a folder's menu, and makes the file in that folder", async () => {
        renderRow(folder)

        await chooseFromRowMenu('docs', 'New from Template…')

        expect(chooseTemplate).toHaveBeenCalledOnce()
        await waitFor(() => expect(promptName).toHaveBeenCalledOnce())
        expect(promptName).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'new-from-template',
                folder: folder.path,
                template: { title: 'Meeting notes', extension: '.md' },
                defaultValue: 'meeting-notes.md',
            })
        )
        await waitFor(() => expect(createFile).toHaveBeenCalledExactlyOnceWith(folder.path, 'standup.md', '# Standup\n'))
    })

    it("offers New from Template… from a folder's ... button too", async () => {
        render(<FileTreeContextMenu node={folder} rowRef={createRef()} />)

        fireEvent.click(screen.getByLabelText('Actions for docs'))
        const menu = await screen.findByRole('menu')
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent)
        ).toEqual(expect.arrayContaining(['New Diagram…', 'New Document…', 'New Folder…', 'New from Template…']))
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'New from Template…' }))

        await waitFor(() => expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new-from-template', folder: folder.path })))
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
            // The other explorer items have icons, so these do too.
            expect(within(menu).getByRole('menuitem', { name }).querySelector('svg')).not.toBeNull()
        }
        expect(within(menu).queryByText('Not in the open folder')).not.toBeInTheDocument()
    })
})

describe('Export Diagrams…', () => {
    it('exports the diagrams in the folder that was right-clicked', async () => {
        renderRow(folder)

        await chooseFromRowMenu('docs', 'Export Diagrams…')

        expect(batch.current!.exportFolder).toHaveBeenCalledWith(folder.path)
    })

    it('is on the folder menu only', async () => {
        renderRow(file)

        fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'plan.md' }), { clientX: 10, clientY: 10 })
        const menu = await screen.findByRole('menu')
        expect(within(menu).queryByRole('menuitem', { name: 'Export Diagrams…' })).not.toBeInTheDocument()
    })

    it('is greyed out, saying why, while another export runs', async () => {
        batch.current = { availability: { disabled: true, reason: 'Exporting…' }, exportFolder: vi.fn() }
        renderRow(folder)

        fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'docs' }), { clientX: 10, clientY: 10 })
        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: 'Export Diagrams…' })).toHaveAttribute('aria-disabled', 'true')
        expect(within(menu).getByText('Exporting…')).toBeInTheDocument()
    })
})
