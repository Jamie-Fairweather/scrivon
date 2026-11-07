import { act, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkspaceExplorer } from './workspace-explorer'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => ({ workspaceName: 'ws', tree: [] }) }))
vi.mock('@/components/studio/explorer/file-tree', () => ({ FileTree: () => null }))
vi.mock('@/components/studio/explorer/examples-explorer', () => ({ ExamplesExplorer: () => null }))
vi.mock('@/components/studio/explorer/file-tree-root-actions', () => ({ FileTreeRootActions: () => null }))
vi.mock('@/components/studio/command-palette/command-palette-trigger-button', () => ({ CommandPaletteTriggerButton: () => null }))

beforeAll(() => {
    // happy-dom has no Web Animations API; Base UI's scroll area asks for running animations.
    Element.prototype.getAnimations ??= () => []
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
