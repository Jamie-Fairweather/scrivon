import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toggleButtonClassName } from '@/lib/ui/button-classes'
import { WorkspaceExplorer } from './workspace-explorer'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => ({ workspaceName: 'ws', tree: [] }) }))
vi.mock('@/components/studio/explorer/file-tree', () => ({ FileTree: () => null }))
vi.mock('@/components/studio/explorer/examples-explorer', () => ({ ExamplesExplorer: () => null }))
vi.mock('@/components/studio/explorer/file-tree-root-actions', () => ({ FileTreeRootActions: () => null }))
vi.mock('@/components/studio/explorer/explorer-tree-buttons', () => ({ ExplorerTreeButtons: () => null }))
vi.mock('@/components/studio/command-palette/command-palette-trigger-button', () => ({ CommandPaletteTriggerButton: () => null }))

afterEach(() => {
    // The chosen panel is kept for the session.
    sessionStorage.clear()
})

describe('WorkspaceExplorer tooltips', () => {
    it.each(['Files', 'Examples'])('labels the %s button in a tooltip that shows on keyboard focus, not a title', async (name) => {
        render(<WorkspaceExplorer />)
        const button = screen.getByRole('button', { name })
        expect(button).not.toHaveAttribute('title')
        // The button's name is only its aria-label, so the text appears only once the tooltip opens.
        expect(screen.queryByText(name)).not.toBeInTheDocument()

        act(() => button.focus())
        expect(await screen.findByText(name)).toBeInTheDocument()
    })
})

describe('WorkspaceExplorer panel toggles', () => {
    it('shows which panel is on with the same toggle style as the other on/off buttons', async () => {
        render(<WorkspaceExplorer />)
        const files = screen.getByRole('button', { name: 'Files' })
        const examples = screen.getByRole('button', { name: 'Examples' })
        for (const button of [files, examples]) {
            expect(button).toHaveClass(...toggleButtonClassName.split(' '))
            expect(button).not.toHaveClass('bg-secondary')
        }
        expect(files).toHaveAttribute('aria-pressed', 'true')
        expect(examples).toHaveAttribute('aria-pressed', 'false')

        await userEvent.setup().click(examples)

        expect(files).toHaveAttribute('aria-pressed', 'false')
        expect(examples).toHaveAttribute('aria-pressed', 'true')
    })
})
