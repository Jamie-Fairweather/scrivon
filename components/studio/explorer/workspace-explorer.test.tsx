import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceExplorer } from './workspace-explorer'

const { useWorkspaceSession } = vi.hoisted(() => ({
    useWorkspaceSession: vi.fn(() => ({ workspaceName: 'ws', tree: [{ kind: 'file', name: 'a.md', path: '/ws/a.md' }] })),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession }))
vi.mock('@/components/studio/explorer/file-tree', () => ({ FileTree: () => <div>File tree</div> }))
vi.mock('@/components/studio/explorer/examples-explorer', () => ({ ExamplesExplorer: () => null }))
vi.mock('@/components/studio/explorer/file-tree-root-actions', () => ({ FileTreeRootActions: () => null }))
vi.mock('@/components/studio/command-palette/command-palette-trigger-button', () => ({ CommandPaletteTriggerButton: () => null }))

/** Stands in for the studio layout, which draws again on every keystroke. */
function Layout() {
    const [text, setText] = useState('')
    return (
        <>
            <button type="button" onClick={() => setText((t) => `${t}x`)}>
                Type {text}
            </button>
            <WorkspaceExplorer />
        </>
    )
}

describe('WorkspaceExplorer', () => {
    it('is not drawn again when the layout around it is', () => {
        render(<Layout />)
        expect(screen.getByText('File tree')).toBeInTheDocument()
        useWorkspaceSession.mockClear()

        fireEvent.click(screen.getByRole('button', { name: /^Type/ }))

        expect(screen.getByRole('button', { name: 'Type x' })).toBeInTheDocument()
        expect(useWorkspaceSession).not.toHaveBeenCalled()
    })
})
