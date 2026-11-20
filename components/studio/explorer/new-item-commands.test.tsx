import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { buildNewItemCommands, useNewItemCommands, type NewItemCommandsContext } from '@/components/studio/explorer/new-item-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { FileNode } from '@/lib/workspace/types'

const { createNewItem, newFromTemplate, openStarterGallery, session, activeTab, layout } = vi.hoisted(() => ({
    createNewItem: vi.fn(async () => true),
    newFromTemplate: vi.fn<(folder: string) => Promise<boolean>>(async () => true),
    openStarterGallery: vi.fn(),
    session: { workspaceRoot: '/ws' as string | null, tree: [] as FileNode[] },
    activeTab: { id: null as string | null },
    layout: { layout: { explorerOpen: true }, setExplorerOpen: vi.fn() },
}))

vi.mock('@/components/studio/explorer/use-file-tree-actions', () => ({
    useCreateNewItem: () => createNewItem,
    useCreateFromTemplate: () => newFromTemplate,
}))
vi.mock('@/components/studio/dialogs/diagram-starters-provider', () => ({ useDiagramStarters: () => ({ openStarterGallery }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => activeTab.id,
    useStudioLayout: () => layout,
}))

function context(overrides: Partial<NewItemCommandsContext> = {}): NewItemCommandsContext {
    return {
        hasWorkspace: true,
        targetFolder: () => '/ws/docs',
        createNewItem: vi.fn(async () => true),
        newFromTemplate: vi.fn(async () => true),
        newFromStarter: vi.fn(),
        showExplorer: vi.fn(),
        ...overrides,
    }
}

const find = (ctx: NewItemCommandsContext, id: string) => buildNewItemCommands(ctx).find((command) => command.id === id)

describe('buildNewItemCommands', () => {
    it('offers a new diagram, document and folder, a new file from a template and a new diagram from a starter', () => {
        const commands = buildNewItemCommands(context())
        const keybinds = createDefaultKeybinds(false)
        expect(commands.map((c) => [c.id, c.label, commandShortcut(c, keybinds, false)])).toEqual([
            ['new-diagram', 'New Diagram…', 'Alt+N'],
            ['new-document', 'New Document…', 'Ctrl+N'],
            ['new-folder', 'New Folder…', undefined],
            ['new-from-template', 'New from Template…', undefined],
            ['new-diagram-from-starter', 'New Diagram from Starter…', undefined],
        ])
        expect(commands.map((c) => c.keybind)).toEqual([
            'workspace.newDiagram',
            'workspace.newDocument',
            'workspace.newFolder',
            'workspace.newFromTemplate',
            // No shortcut setting yet.
            undefined,
        ])
    })

    it('opens the Diagram Starters window for the folder new items go in when it runs', () => {
        let folder: string | null = '/ws/docs'
        const ctx = context({ targetFolder: () => folder })
        const command = find(ctx, 'new-diagram-from-starter')!

        folder = '/ws/old'
        void command.run()
        expect(ctx.newFromStarter).toHaveBeenCalledExactlyOnceWith('/ws/old')
        expect(ctx.createNewItem).not.toHaveBeenCalled()

        folder = null
        void command.run()
        expect(ctx.newFromStarter).toHaveBeenCalledTimes(1)
    })

    it('runs New from Template on keys the user sets', () => {
        const command = find(context(), 'new-from-template')!
        const keybinds = { ...createDefaultKeybinds(false), 'workspace.newFromTemplate': [{ key: 't', ctrl: true, alt: true }] }
        expect(commandShortcut(command, keybinds, false)).toBe('Ctrl+Alt+T')
    })

    it('starts a new file from a template in the folder new items go in when it runs', async () => {
        let folder: string | null = '/ws/docs'
        const ctx = context({ targetFolder: () => folder })
        const command = find(ctx, 'new-from-template')!

        folder = '/ws/old'
        await act(async () => void command.run())
        expect(ctx.newFromTemplate).toHaveBeenCalledExactlyOnceWith('/ws/old')
        expect(ctx.createNewItem).not.toHaveBeenCalled()
        expect(ctx.showExplorer).not.toHaveBeenCalled()

        folder = null
        await act(async () => void command.run())
        expect(ctx.newFromTemplate).toHaveBeenCalledTimes(1)
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

    it.each(['new-diagram', 'new-document', 'new-folder', 'new-from-template', 'new-diagram-from-starter'])(
        'says to open a folder first when none is open (%s)',
        (id) => {
            expect(find(context({ hasWorkspace: false }), id)).toMatchObject({ disabled: true, disabledReason: 'Open a folder first' })
            expect(find(context(), id)).toMatchObject({ disabled: false })
        }
    )
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

    it('starts a new file from a template in the folder New Document would use', () => {
        activeTab.id = '/ws/docs/notes.md'
        const command = renderCommands()

        act(() => void command('new-from-template').run())
        expect(newFromTemplate).toHaveBeenCalledWith('/ws/docs')

        row('/ws/drafts').focus()
        act(() => void command('new-from-template').run())
        expect(newFromTemplate).toHaveBeenLastCalledWith('/ws/drafts')
        expect(createNewItem).not.toHaveBeenCalled()
    })

    it('opens the Diagram Starters window to make a new file in the folder New Document would use, with no file open', () => {
        const command = renderCommands()

        act(() => void command('new-diagram-from-starter').run())
        expect(openStarterGallery).toHaveBeenCalledExactlyOnceWith({ primary: 'new-file', folder: '/ws' })

        row('/ws/drafts').focus()
        act(() => void command('new-diagram-from-starter').run())
        expect(openStarterGallery).toHaveBeenLastCalledWith({ primary: 'new-file', folder: '/ws/drafts' })
        expect(createNewItem).not.toHaveBeenCalled()
    })

    it('is off with no folder open', () => {
        session.workspaceRoot = null
        session.tree = []
        const command = renderCommands()

        expect(command('new-document').disabled).toBe(true)
        expect(command('new-from-template').disabled).toBe(true)
        expect(command('new-diagram-from-starter')).toMatchObject({ disabled: true, disabledReason: 'Open a folder first' })
    })
})
