import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { useExplorerCommands } from '@/components/studio/explorer/explorer-commands'
import { setExplorerPanel, useExplorerPanel, useRevealActiveFileRequests } from '@/components/studio/explorer/explorer-view'
import { closedFoldersAbove } from '@/lib/workspace/folder-toggles'
import type { FileNode } from '@/lib/workspace/types'
import { ExplorerTreeButtons } from './explorer-tree-buttons'

const state = vi.hoisted(() => ({
    workspaceRoot: '/ws' as string | null,
    activeTabId: null as string | null,
    toggles: new Map() as ReadonlyMap<string, boolean>,
    explorerOpen: true,
    setFoldersExpanded: vi.fn(),
    setExplorerOpen: vi.fn(),
    chooseFolder: vi.fn<(node: unknown) => Promise<string | null>>(async () => null),
    moveEntry: vi.fn(async () => null),
}))

const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [
            { kind: 'directory', name: 'old', path: '/ws/docs/old', children: [] },
            { kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' },
        ],
    },
    { kind: 'directory', name: 'empty', path: '/ws/empty', children: [] },
    { kind: 'file', name: 'flow.mmd', path: '/ws/flow.mmd' },
]

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({
        workspaceRoot: state.workspaceRoot,
        tree,
        folderToggles: state.toggles,
        setFoldersExpanded: state.setFoldersExpanded,
        moveEntry: state.moveEntry,
    }),
    useActiveTabId: () => state.activeTabId,
    useStudioLayout: () => ({ layout: { explorerOpen: state.explorerOpen }, setExplorerOpen: state.setExplorerOpen }),
}))
// Counts the walks through the tree that check whether Reveal can be used.
vi.mock('@/lib/workspace/folder-toggles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/workspace/folder-toggles')>()
    return { ...actual, closedFoldersAbove: vi.fn(actual.closedFoldersAbove) }
})
vi.mock('@/components/studio/dialogs/move-to-provider', () => ({ useMoveTo: () => ({ chooseFolder: state.chooseFolder }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: () => ({ settings: { keybinds: {} } }) }))

beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    state.workspaceRoot = '/ws'
    state.activeTabId = '/ws/docs/notes.md'
    state.toggles = new Map()
    state.explorerOpen = true
})

describe('ExplorerTreeButtons', () => {
    it('closes every open folder from Collapse all folders', async () => {
        state.toggles = new Map([['/ws/empty', false]])
        render(<ExplorerTreeButtons />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse all folders' }))

        // Deepest first, so the top folders are saved last.
        expect(state.setFoldersExpanded).toHaveBeenCalledWith(['/ws/docs/old', '/ws/docs'], false)
    })

    it('asks the tree to show the open file from Reveal active file', async () => {
        const requests = renderHook(useRevealActiveFileRequests)
        const before = requests.result.current
        render(<ExplorerTreeButtons />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reveal active file' }))

        expect(requests.result.current).toBe(before + 1)
        // The explorer is already showing.
        expect(state.setExplorerOpen).not.toHaveBeenCalled()
    })

    it('says why Reveal active file does nothing when the open tab is not a file in the folder', async () => {
        state.activeTabId = 'example:flowchart'
        const requests = renderHook(useRevealActiveFileRequests)
        const before = requests.result.current
        render(<ExplorerTreeButtons />)
        const reveal = screen.getByRole('button', { name: 'Reveal active file' })

        // Still focusable, so the reason can be found: in the tooltip, and as the description for screen readers.
        expect(reveal).toHaveAttribute('aria-disabled', 'true')
        expect(reveal).toHaveAccessibleDescription('No file from the folder is open')
        act(() => reveal.focus())
        expect(await screen.findByText('No file from the folder is open', { selector: '[data-slot="tooltip-popup"] *' })).toBeInTheDocument()

        await userEvent.setup().click(reveal)
        expect(requests.result.current).toBe(before)
    })

    it('labels both buttons in tooltips that show on keyboard focus', async () => {
        render(<ExplorerTreeButtons />)
        const collapse = screen.getByRole('button', { name: 'Collapse all folders' })
        expect(collapse).not.toHaveAttribute('title')

        act(() => collapse.focus())
        expect(await screen.findByText('Collapse all folders')).toBeInTheDocument()
    })
})

describe('explorer commands in the palette', () => {
    function wrapper({ children }: { children: ReactNode }) {
        return (
            <CommandRegistryProvider>
                <ExplorerCommands />
                {children}
            </CommandRegistryProvider>
        )
    }
    function ExplorerCommands() {
        useExplorerCommands()
        return null
    }
    const command = (commands: ReturnType<typeof useCommands>, id: string) => commands.find((c) => c.id === id)!

    it('shows the hidden explorer on its Files panel, then the open file', () => {
        state.explorerOpen = false
        setExplorerPanel('examples')
        const { result } = renderHook(() => ({ commands: useCommands(), panel: useExplorerPanel(), requests: useRevealActiveFileRequests() }), {
            wrapper,
        })
        const before = result.current.requests

        act(() => void command(result.current.commands, 'reveal-active-file').run())

        expect(state.setExplorerOpen).toHaveBeenCalledWith(true)
        expect(result.current.panel).toBe('files')
        expect(result.current.requests).toBe(before + 1)
    })

    it('collapses every folder', () => {
        const { result } = renderHook(useCommands, { wrapper })

        act(() => void command(result.current, 'collapse-all-folders').run())

        expect(state.setFoldersExpanded).toHaveBeenCalledWith(['/ws/docs/old', '/ws/empty', '/ws/docs'], false)
    })

    it('moves the open file to the folder picked', async () => {
        state.chooseFolder.mockResolvedValueOnce('/ws/empty')
        const { result } = renderHook(useCommands, { wrapper })

        await act(async () => {
            command(result.current, 'move-active-file').run()
        })

        expect(state.chooseFolder).toHaveBeenCalledWith({ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' })
        expect(state.moveEntry).toHaveBeenCalledWith('/ws/docs/notes.md', false, '/ws/empty')
    })

    it('moves nothing when no folder is picked', async () => {
        const { result } = renderHook(useCommands, { wrapper })

        await act(async () => {
            command(result.current, 'move-active-file').run()
        })

        expect(state.chooseFolder).toHaveBeenCalled()
        expect(state.moveEntry).not.toHaveBeenCalled()
    })

    it('turns Reveal off when no file from the folder is open, and both off with no folder', () => {
        state.activeTabId = null
        const { result, rerender } = renderHook(useCommands, { wrapper })
        expect(command(result.current, 'reveal-active-file').disabled).toBe(true)
        expect(command(result.current, 'collapse-all-folders').disabled).toBe(false)

        state.workspaceRoot = null
        rerender()
        expect(command(result.current, 'collapse-all-folders').disabled).toBe(true)
    })

    it('checks the tree only when the tree, the folders or the open file change, not on every draw', () => {
        const { rerender } = renderHook(useCommands, { wrapper })
        const walks = vi.mocked(closedFoldersAbove).mock.calls.length
        expect(walks).toBeGreaterThan(0)

        rerender()
        rerender()
        expect(closedFoldersAbove).toHaveBeenCalledTimes(walks)

        state.activeTabId = '/ws/flow.mmd'
        rerender()
        expect(vi.mocked(closedFoldersAbove).mock.calls.length).toBeGreaterThan(walks)
    })
})
