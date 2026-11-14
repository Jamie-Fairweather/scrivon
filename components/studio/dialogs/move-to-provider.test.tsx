import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { MoveToProvider, useMoveTo } from './move-to-provider'

const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: 'C:\\ws\\docs',
        children: [
            { kind: 'directory', name: 'old', path: 'C:\\ws\\docs\\old', children: [] },
            { kind: 'file', name: 'notes.md', path: 'C:\\ws\\docs\\notes.md' },
        ],
    },
    { kind: 'directory', name: 'archive', path: 'C:\\ws\\archive', children: [] },
    { kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' },
]

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ tree, workspaceRoot: 'C:\\ws' }),
}))

/** Asks where to move `node` when its button is clicked, and shows the answer. */
function Asker({ node }: { node: FileNode }) {
    const { chooseFolder } = useMoveTo()
    const [answer, setAnswer] = useState<string>('none yet')
    return (
        <button type="button" onClick={() => void chooseFolder(node).then((path) => setAnswer(String(path)))}>
            Move {node.name}: {answer}
        </button>
    )
}

function renderAsker(node: FileNode) {
    render(
        <MoveToProvider>
            <Asker node={node} />
        </MoveToProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Move ${node.name}`) }))
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

describe('Move to…', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('lists the folders in the open folder, and the one picked is the answer', async () => {
        renderAsker(tree[0]!.kind === 'directory' ? tree[0]!.children[1]! : tree[0]!)

        expect(await screen.findByRole('dialog', { name: 'Move "notes.md" to…' })).toBeInTheDocument()
        expect(optionNames()).toEqual(['wsTop of the folder', 'docsCurrent folder', 'docs/old', 'archive'])
        expect(screen.getByRole('option', { name: /^docs\s*Current folder$/ })).toHaveAttribute('aria-disabled', 'true')

        fireEvent.click(screen.getByRole('option', { name: 'archive' }))

        await waitFor(() => expect(screen.getByRole('button', { name: 'Move notes.md: C:\\ws\\archive' })).toBeInTheDocument())
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('narrows the list to the folders whose names match what is typed', async () => {
        renderAsker({ kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' })

        fireEvent.change(await screen.findByRole('combobox', { name: 'Folder to move to' }), { target: { value: 'old' } })

        await waitFor(() => expect(optionNames()).toEqual(['docs/old']))
    })

    it('picks the highlighted folder with Enter', async () => {
        renderAsker({ kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' })
        const input = await screen.findByRole('combobox', { name: 'Folder to move to' })

        fireEvent.change(input, { target: { value: 'arch' } })
        await waitFor(() => expect(optionNames()).toEqual(['archive']))
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(screen.getByRole('button', { name: 'Move flow.mmd: C:\\ws\\archive' })).toBeInTheDocument())
    })

    it('answers null when closed without picking a folder', async () => {
        renderAsker({ kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' })
        const input = await screen.findByRole('combobox', { name: 'Folder to move to' })

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Escape' })
        })

        await waitFor(() => expect(screen.getByRole('button', { name: 'Move flow.mmd: null' })).toBeInTheDocument())
    })

    it('leaves a moving folder and the folders inside it out of the list', async () => {
        renderAsker(tree[0]!)

        await screen.findByRole('dialog')
        expect(optionNames()).toEqual(['wsTop of the folderCurrent folder', 'archive'])
    })
})
