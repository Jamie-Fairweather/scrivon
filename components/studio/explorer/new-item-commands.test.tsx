import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { buildNewItemCommands, useNewItemCommands, type NewItemCommandsContext } from '@/components/studio/explorer/new-item-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { FileNode } from '@/lib/workspace/types'

const { createNewItem, session, activeTab, layout } = vi.hoisted(() => ({
    createNewItem: vi.fn(async () => true),
    session: { workspaceRoot: '/ws' as string | null, tree: [] as FileNode[] },
    activeTab: { id: null as string | null },
    layout: { layout: { explorerOpen: true }, setExplorerOpen: vi.fn() },
}))

vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({ useCreateNewItem: () => createNewItem }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => activeTab.id,
    useStudioLayout: () => layout,
}))

function context(overrides: Partial<NewItemCommandsContext> = {}): NewItemCommandsContext {
    return { hasWorkspace: true, targetFolder: () => '/ws/docs', createNewItem: vi.fn(async () => true), showExplorer: vi.fn(), ...overrides }
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

    it('opens the explorer once a new folder is named, as only the explorer shows it', async () => {
        const ctx = context()
        await act(async () => void find(ctx, 'new-folder')!.run())
        expect(ctx.showExplorer).toHaveBeenCalledTimes(1)
    })

    it('leaves the explorer alone after a new file, or a cancelled new folder', async () => {
        const ctx = context()
        await act(async () => void find(ctx, 'new-document')!.run())
        await act(async () => void find(ctx, 'new-diagram')!.run())
        vi.mocked(ctx.createNewItem).mockResolvedValueOnce(false)
        await act(async () => void find(ctx, 'new-folder')!.run())

        expect(ctx.createNewItem).toHaveBeenCalledTimes(3)
        expect(ctx.showExplorer).not.toHaveBeenCalled()
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
        layout.layout.explorerOpen = true
        document.body.innerHTML = ''
    })

    /** An element on the page that can take focus, such as an explorer row or a menu title. */
    function focusable(tag: string, attributes: Record<string, string> = {}, parent: HTMLElement = document.body): HTMLElement {
        const el = document.createElement(tag)
        for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
        el.tabIndex = 0
        parent.append(el)
        return el
    }

    const row = (path: string) => focusable('div', { role: 'treeitem', 'data-path': path })

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
        row('/ws/drafts').focus()

        act(() => void command('new-diagram').run())

        expect(createNewItem).toHaveBeenCalledWith('new-diagram', '/ws/drafts')
    })

    it.each([
        ['the menu bar', 'menubar'],
        ['a menu', 'menu'],
        ['the palette', 'dialog'],
    ])('creates in the explorer row the keyboard was on before %s took it', (_name, role) => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()
        row('/ws/drafts').focus()
        focusable('button', {}, focusable('div', { role })).focus()

        act(() => void command('new-document').run())

        expect(createNewItem).toHaveBeenCalledWith('new-document', '/ws/drafts')
    })

    it("uses the open file's folder once the keyboard has moved on from the row", () => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()
        row('/ws/drafts').focus()
        focusable('textarea').focus()
        focusable('div', { role: 'menubar' }).focus()

        act(() => void command('new-document').run())

        expect(createNewItem).toHaveBeenCalledWith('new-document', '/ws/docs')
    })

    it("uses the open file's folder once the row has left the page (the explorer was hidden)", () => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()
        const drafts = row('/ws/drafts')
        drafts.focus()
        focusable('div', { role: 'dialog' }).focus()
        drafts.remove()

        act(() => void command('new-document').run())

        expect(createNewItem).toHaveBeenCalledWith('new-document', '/ws/docs')
    })

    it('opens the explorer after a new folder when it is hidden', async () => {
        layout.layout.explorerOpen = false
        const command = renderCommands()

        await act(async () => void command('new-folder').run())

        expect(layout.setExplorerOpen).toHaveBeenCalledWith(true)
    })

    it('leaves the explorer as it is after a new folder when it is already open', async () => {
        const command = renderCommands()

        await act(async () => void command('new-folder').run())

        expect(createNewItem).toHaveBeenCalledWith('new-folder', '/ws')
        expect(layout.setExplorerOpen).not.toHaveBeenCalled()
    })

    it('is off with no folder open', () => {
        session.workspaceRoot = null
        session.tree = []
        const command = renderCommands()

        expect(command('new-document').disabled).toBe(true)
    })
})
