import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'
import { DeleteConfirmProvider, useDeleteConfirm } from './delete-confirm-provider'

const { openTabs } = vi.hoisted(() => ({ openTabs: { list: [] as Pick<DocumentTab, 'path' | 'name' | 'isDirty'>[] } }))

vi.mock('@/components/studio/workspace/workspace-provider', async () => {
    const { tabsToCloseOnDelete } = await import('@/lib/workspace/tab-paths')
    return {
        useWorkspaceSession: () => ({ workspaceRoot: 'C:\\ws' }),
        useWorkspaceCoordinator: () => ({
            findTabsToCloseOnDelete: {
                current: (path: string, isDirectory: boolean) => tabsToCloseOnDelete(openTabs.list as DocumentTab[], path, isDirectory),
            },
        }),
    }
})

function Opener({ node, onResult }: { node: FileNode; onResult: (ok: boolean) => void }) {
    const { confirmDelete } = useDeleteConfirm()
    return (
        <button type="button" onClick={() => void confirmDelete(node).then(onResult)}>
            Ask
        </button>
    )
}

/** Lets the dialog finish opening or closing: it waits an animation frame. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

async function ask(node: FileNode) {
    const onResult = vi.fn()
    render(
        <DeleteConfirmProvider>
            <Opener node={node} onResult={onResult} />
        </DeleteConfirmProvider>
    )
    fireEvent.click(screen.getByText('Ask'))
    await settle()
    return { onResult, dialog: screen.getByRole('alertdialog') }
}

const docs: FileNode = {
    kind: 'directory',
    name: 'docs',
    path: 'C:\\ws\\guides\\docs',
    children: [
        { kind: 'file', name: 'README.md', path: 'C:\\ws\\guides\\docs\\README.md' },
        {
            kind: 'directory',
            name: 'img',
            path: 'C:\\ws\\guides\\docs\\img',
            children: [{ kind: 'file', name: 'a.png', path: 'C:\\ws\\guides\\docs\\img\\a.png' }],
        },
    ],
}

describe('DeleteConfirmProvider', () => {
    beforeEach(() => {
        openTabs.list = []
    })

    it('says a file goes to the Recycle Bin, naming it by where it is in the folder', async () => {
        const { dialog, onResult } = await ask({ kind: 'file', name: 'README.md', path: 'C:\\ws\\guides\\README.md' })

        expect(within(dialog).getByRole('heading', { name: 'Delete file?' })).toBeInTheDocument()
        expect(dialog).toHaveTextContent('Moves guides\\README.md to the Recycle Bin.')
        expect(dialog).not.toHaveTextContent('cannot be undone')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
        await settle()
        expect(onResult).toHaveBeenCalledWith(true)
    })

    it('says how many files a folder has, and which open tabs close and lose unsaved changes', async () => {
        openTabs.list = [
            { path: 'C:\\ws\\guides\\docs\\README.md', name: 'README.md', isDirty: true },
            { path: 'C:\\ws\\guides\\docs\\img\\notes.md', name: 'notes.md', isDirty: false },
            { path: 'C:\\ws\\other.md', name: 'other.md', isDirty: true },
        ]

        const { dialog, onResult } = await ask(docs)

        expect(within(dialog).getByRole('heading', { name: 'Delete folder?' })).toBeInTheDocument()
        expect(dialog).toHaveTextContent('Moves guides\\docs and everything in it to the Recycle Bin. It has 2 files in it.')
        expect(dialog).toHaveTextContent('Closes 2 open tabs: README.md and img\\notes.md.')
        expect(dialog).toHaveTextContent('Unsaved changes in README.md will be lost.')
        expect(dialog).not.toHaveTextContent('other.md')
        // A screen reader reads all of it as the dialog opens, the unsaved warning most of all.
        expect(dialog).toHaveAccessibleDescription(expect.stringContaining('It has 2 files in it.'))
        expect(dialog).toHaveAccessibleDescription(expect.stringContaining('Closes 2 open tabs: README.md and img\\notes.md.'))
        expect(dialog).toHaveAccessibleDescription(expect.stringContaining('Unsaved changes in README.md will be lost.'))

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await settle()
        expect(onResult).toHaveBeenCalledWith(false)
    })

    it('leaves out the tab lines when nothing open is affected', async () => {
        const { dialog } = await ask(docs)

        expect(dialog).not.toHaveTextContent('open tab')
        expect(dialog).not.toHaveTextContent('Unsaved')
    })
})
