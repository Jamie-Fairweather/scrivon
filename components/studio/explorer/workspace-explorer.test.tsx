import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
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
vi.mock('@/components/studio/explorer/explorer-background-menu', () => ({
    ExplorerBackgroundMenu: ({ children }: { children: ReactNode }) => <div data-testid="background-menu">{children}</div>,
}))

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

    it('has the empty-space menu around the file list, also when the folder is empty', () => {
        render(<WorkspaceExplorer />)
        expect(screen.getByTestId('background-menu')).toContainElement(screen.getByText('File tree'))

        useWorkspaceSession.mockReturnValueOnce({ workspaceName: 'ws', tree: [] })
        render(<WorkspaceExplorer />)
        expect(screen.getAllByTestId('background-menu')[1]).toContainElement(screen.getByText('No files in this folder.'))
    })

    it('keeps the scroll box out of the Tab order when the file list is long enough to scroll', async () => {
        // The test DOM lays nothing out, so every box is made taller inside than out, as a long list is.
        const sizes = [
            vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100),
            vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000),
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100),
            vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100),
        ]
        try {
            render(<WorkspaceExplorer />)
            const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
            await waitFor(() => expect(viewport).toHaveAttribute('data-has-overflow-y'))

            expect(viewport.tabIndex).toBe(-1)
        } finally {
            for (const size of sizes) size.mockRestore()
        }
    })
})
