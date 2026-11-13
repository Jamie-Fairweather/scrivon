import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { buildNewItemCommands, useNewItemCommands, type NewItemCommandsContext } from '@/components/studio/explorer/new-item-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { FileNode } from '@/lib/workspace/types'

const { createNewItem, session, activeTab } = vi.hoisted(() => ({
    createNewItem: vi.fn(async () => {}),
    session: { workspaceRoot: '/ws' as string | null, tree: [] as FileNode[] },
    activeTab: { id: null as string | null },
}))

vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({ useCreateNewItem: () => createNewItem }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => activeTab.id,
}))

function context(overrides: Partial<NewItemCommandsContext> = {}): NewItemCommandsContext {
    return { hasWorkspace: true, targetFolder: () => '/ws/docs', createNewItem: vi.fn(async () => {}), ...overrides }
}

const find = (ctx: NewItemCommandsContext, id: string) => buildNewItemCommands(ctx).find((command) => command.id === id)

describe('buildNewItemCommands', () => {
    it('offers a new diagram, document and folder, on their own shortcuts', () => {
        const commands = buildNewItemCommands(context())
        const keybinds = createDefaultKeybinds(false)
        expect(commands.map((c) => [c.label, commandShortcut(c, keybinds, false)])).toEqual([
            ['New Diagram…', 'Ctrl+Alt+N'],
            ['New Document…', 'Ctrl+N'],
            ['New Folder…', undefined],
        ])
        expect(commands.map((c) => c.keybind)).toEqual(['workspace.newDiagram', 'workspace.newDocument', 'workspace.newFolder'])
    })

    it('creates in the folder new items go in when it runs', () => {
        let folder = '/ws/docs'
        const ctx = context({ targetFolder: () => folder })
        const commands = buildNewItemCommands(ctx)

        folder = '/ws/old'
        void commands.find((c) => c.id === 'new-document')!.run()
        void commands.find((c) => c.id === 'new-diagram')!.run()
        void commands.find((c) => c.id === 'new-folder')!.run()

        expect(ctx.createNewItem).toHaveBeenNthCalledWith(1, 'new-document', '/ws/old')
        expect(ctx.createNewItem).toHaveBeenNthCalledWith(2, 'new-diagram', '/ws/old')
        expect(ctx.createNewItem).toHaveBeenNthCalledWith(3, 'new-folder', '/ws/old')
    })

    it('says to open a folder first when none is open', () => {
        expect(find(context({ hasWorkspace: false }), 'new-document')).toMatchObject({ disabled: true, disabledReason: 'Open a folder first' })
        expect(find(context(), 'new-document')).toMatchObject({ disabled: false })
    })
})

describe('useNewItemCommands', () => {
    const tree: FileNode[] = [
        {
            kind: 'directory',
            name: 'docs',
            path: '/ws/docs',
            children: [{ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' }],
        },
        { kind: 'directory', name: 'drafts', path: '/ws/drafts', children: [] },
    ]

    beforeEach(() => {
        vi.clearAllMocks()
        session.workspaceRoot = '/ws'
        session.tree = tree
        activeTab.id = null
        document.body.innerHTML = ''
    })

    function renderCommands() {
        let shown: ReturnType<typeof useCommands> = []
        function Commands() {
            useNewItemCommands()
            const commands = useCommands()
            useEffect(() => {
                shown = commands
            }, [commands])
            return null
        }
        render(
            <CommandRegistryProvider>
                <Commands />
            </CommandRegistryProvider>
        )
        return (id: string) => shown.find((command) => command.id === id)!
    }

    it("creates in the open file's folder, without the explorer on screen", () => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()

        act(() => void command('new-document').run())

        expect(createNewItem).toHaveBeenCalledWith('new-document', '/ws/docs')
    })

    it('creates in the workspace root when no file is open', () => {
        const command = renderCommands()

        act(() => void command('new-folder').run())

        expect(createNewItem).toHaveBeenCalledWith('new-folder', '/ws')
    })

    it('creates in the explorer row the keyboard is on, when the shortcut is pressed there', () => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()
        const row = document.createElement('div')
        row.setAttribute('role', 'treeitem')
        row.dataset.path = '/ws/drafts'
        row.tabIndex = 0
        document.body.append(row)
        row.focus()

        act(() => void command('new-diagram').run())

        expect(createNewItem).toHaveBeenCalledWith('new-diagram', '/ws/drafts')
    })

    it('is off with no folder open', () => {
        session.workspaceRoot = null
        session.tree = []
        const command = renderCommands()

        expect(command('new-document').disabled).toBe(true)
    })
})
