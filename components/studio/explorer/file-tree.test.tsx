import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { requestRevealActiveFile } from '@/components/studio/explorer/explorer-view'
import { isMermaidFile } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'
import { FileTree } from './file-tree'

const { tabs, tabContent, folders, session, confirmDelete, promptName } = vi.hoisted(() => ({
    tabs: { activeTabId: null as string | null, openFile: vi.fn(async () => undefined) },
    /** The tabs with their text, which change on every keystroke. */
    tabContent: { text: '', listeners: new Set<() => void>() },
    /** The session's open or closed folders, which outlive the tree. */
    folders: { toggles: new Map() as ReadonlyMap<string, boolean>, listeners: new Set<() => void>() },
    session: {
        setFolderExpanded: vi.fn((path: string, expanded: boolean) => {
            folders.toggles = new Map(folders.toggles).set(path, expanded)
            folders.listeners.forEach((l) => l())
        }),
        setFoldersExpanded: vi.fn((paths: readonly string[], expanded: boolean) => {
            const next = new Map(folders.toggles)
            for (const path of paths) next.set(path, expanded)
            folders.toggles = next
            folders.listeners.forEach((l) => l())
        }),
        openFile: vi.fn(async () => undefined),
        renameEntry: vi.fn(async () => undefined),
        deleteEntry: vi.fn(async () => undefined),
        duplicateFile: vi.fn(async () => undefined),
        createFile: vi.fn(async () => undefined),
        createFolder: vi.fn(async () => undefined),
        suggestName: vi.fn((_parent: string, name: string) => name),
        getNameError: vi.fn(() => null),
    },
    confirmDelete: vi.fn(async () => false),
    promptName: vi.fn(async () => null),
}))

vi.mock('@/components/studio/workspace/workspace-provider', async () => {
    const { useSyncExternalStore } = await import('react')
    const subscribe = (store: { listeners: Set<() => void> }) => (listener: () => void) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
    }
    return {
        useDocumentTabs: () => ({ ...tabs, text: useSyncExternalStore(subscribe(tabContent), () => tabContent.text) }),
        useActiveTabId: () => tabs.activeTabId,
        useDocumentTabActions: () => tabs,
        useWorkspaceSession: () => ({ ...session, folderToggles: useSyncExternalStore(subscribe(folders), () => folders.toggles) }),
    }
})
vi.mock('@/components/studio/dialogs/delete-confirm-provider', () => ({ useDeleteConfirm: () => ({ confirmDelete }) }))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
// Each file row asks isMermaidFile once as it draws, which shows which rows were drawn again.
vi.mock('@/lib/tauri/fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/tauri/fs')>()
    return { ...actual, isMermaidFile: vi.fn(actual.isMermaidFile) }
})

const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [{ kind: 'file', name: 'notes.md', path: '/ws/docs/notes.md' }],
    },
    { kind: 'file', name: 'flow.mmd', path: '/ws/flow.mmd' },
    { kind: 'file', name: 'photo.png', path: '/ws/photo.png' },
]

const item = (name: string) => screen.getByRole('treeitem', { name })
const press = (name: string, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(item(name), { key, ...init })

async function chooseFromActionsMenu(name: string, menuItem: string) {
    fireEvent.click(screen.getByLabelText(`Actions for ${name}`))
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: menuItem }))
}

describe('FileTree', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        tabs.activeTabId = null
        folders.toggles = new Map()
    })

    it('exposes a tree with levels, open state and the open file', () => {
        tabs.activeTabId = '/ws/flow.mmd'
        render(<FileTree tree={tree} />)

        expect(screen.getByRole('tree', { name: 'Files' })).toBeInTheDocument()
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
        expect(item('docs')).toHaveAttribute('aria-level', '1')
        expect(item('notes.md')).toHaveAttribute('aria-level', '2')
        expect(item('notes.md')).not.toHaveAttribute('aria-expanded')
        expect(item('flow.mmd')).toHaveAttribute('aria-selected', 'true')
    })

    it('describes why an unsupported file will not open, without marking it unavailable', () => {
        render(<FileTree tree={tree} />)

        // It can still be renamed, duplicated and deleted, so screen readers must not call it disabled.
        expect(item('photo.png')).not.toHaveAttribute('aria-disabled')
        expect(item('photo.png')).toHaveAccessibleDescription('Scrivon supports .md, .mmd and .mermaid files only')
        expect(item('flow.mmd')).not.toHaveAttribute('aria-describedby')
    })

    it('shows the full name on hover, and why an unsupported file will not open', () => {
        render(<FileTree tree={tree} />)

        expect(item('flow.mmd')).toHaveAttribute('title', 'flow.mmd')
        expect(item('photo.png')).toHaveAttribute('title', 'photo.png\nScrivon supports .md, .mmd and .mermaid files only')
    })

    it('marks a folder that could not be read, and says why on hover and to screen readers', () => {
        render(<FileTree tree={[{ kind: 'directory', name: 'private', path: '/ws/private', children: [], unreadable: true }, ...tree]} />)

        const row = item('private')
        const hint = "Can't be read. Scrivon may not have permission to open it."
        expect(row).toHaveAccessibleDescription(hint)
        expect(row).toHaveAttribute('title', `private\n${hint}`)
        expect(row).toHaveClass('text-muted-foreground')
        expect(row.querySelector('[data-mark="unreadable"]')).toBeInTheDocument()
        expect(row.querySelector('[data-mark="links-outside"]')).not.toBeInTheDocument()
        // A folder that was read normally gets no mark.
        expect(item('docs')).not.toHaveAttribute('aria-describedby')
        expect(item('docs').querySelector('[data-mark]')).not.toBeInTheDocument()
    })

    it('marks a link to a folder outside the open one differently from a folder it could not read', () => {
        render(
            <FileTree
                tree={[{ kind: 'directory', name: 'shared', path: '/ws/shared', children: [], unreadable: true, linksOutside: true }, ...tree]}
            />
        )

        const row = item('shared')
        const hint = "Links to a folder outside the open one, which Scrivon can't open yet."
        expect(row).toHaveAccessibleDescription(hint)
        expect(row).toHaveAttribute('title', `shared\n${hint}`)
        expect(row.querySelector('[data-mark="links-outside"]')).toBeInTheDocument()
        expect(row.querySelector('[data-mark="unreadable"]')).not.toBeInTheDocument()
    })

    it('marks a folder that was not read because the open folder is too big, so it does not look empty', () => {
        render(<FileTree tree={[{ kind: 'directory', name: 'more', path: '/ws/more', children: [], truncated: true }, ...tree]} />)

        const row = item('more')
        const hint = 'Not read: the open folder has too many files and folders to list them all.'
        expect(row).toHaveAccessibleDescription(hint)
        expect(row).toHaveAttribute('title', `more\n${hint}`)
        expect(row).toHaveClass('text-muted-foreground')
        expect(row.querySelector('[data-mark="truncated"]')).toBeInTheDocument()
        expect(row.querySelector('[data-mark="unreadable"]')).not.toBeInTheDocument()
    })

    it('turns the folder arrow without animating when animations are off', () => {
        render(<FileTree tree={tree} />)

        expect(item('docs').querySelector('.lucide-chevron-right')).toHaveClass('transition-transform', 'motion-reduce:transition-none')
    })

    it('is a single Tab stop, on the open file', () => {
        tabs.activeTabId = '/ws/flow.mmd'
        render(<FileTree tree={tree} />)

        const tabbable = screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)
        expect(tabbable).toEqual([item('flow.mmd')])
        expect(screen.getByLabelText('Actions for flow.mmd')).toHaveAttribute('tabindex', '-1')
    })

    it('moves focus with the arrow keys, Home and End, and the Tab stop follows', () => {
        render(<FileTree tree={tree} />)
        item('docs').focus()

        press('docs', 'ArrowDown')
        expect(item('notes.md')).toHaveFocus()
        expect(item('notes.md').tabIndex).toBe(0)
        expect(item('docs').tabIndex).toBe(-1)

        press('notes.md', 'End')
        expect(item('photo.png')).toHaveFocus()
        press('photo.png', 'Home')
        expect(item('docs')).toHaveFocus()
        press('notes.md', 'ArrowLeft')
        expect(item('docs')).toHaveFocus()
    })

    it('jumps to a row by typing the start of its name', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            render(<FileTree tree={tree} />)
            item('docs').focus()

            press('docs', 'n')
            expect(item('notes.md')).toHaveFocus()

            vi.advanceTimersByTime(1000)
            press('notes.md', 'P', { shiftKey: true })
            expect(item('photo.png')).toHaveFocus()

            // Letters typed in quick succession make one word; a word nothing starts with leaves focus where it is.
            vi.advanceTimersByTime(1000)
            press('photo.png', 'f')
            press('flow.mmd', 'l')
            expect(item('flow.mmd')).toHaveFocus()
            press('flow.mmd', 'x')
            expect(item('flow.mmd')).toHaveFocus()
            expect(tabs.openFile).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('closes and opens folders with Left and Right, and with Enter', () => {
        render(<FileTree tree={tree} />)

        press('docs', 'ArrowLeft')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('treeitem', { name: 'notes.md' })).not.toBeInTheDocument()

        press('docs', 'ArrowRight')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')

        press('docs', 'Enter')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        expect(session.setFolderExpanded).toHaveBeenLastCalledWith('/ws/docs', false)
    })

    it("keeps a folder closed after the tree is hidden and shown again, through the session's folder state", () => {
        const first = render(<FileTree tree={tree} />)
        press('docs', 'ArrowLeft')
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        // Ctrl+B, or switching to Examples, takes the tree away.
        first.unmount()

        render(<FileTree tree={tree} />)
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('treeitem', { name: 'notes.md' })).not.toBeInTheDocument()
    })

    it('opens folders as the session has them, whatever way their path is written', () => {
        folders.toggles = new Map([['C:\\ws\\docs', false]])
        render(<FileTree tree={[{ kind: 'directory', name: 'docs', path: 'C:/ws/docs', children: [] }]} />)
        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens a supported file with Enter or a click, and ignores unsupported ones', () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'Enter')
        fireEvent.click(item('notes.md'))
        press('photo.png', 'Enter')

        expect(tabs.openFile).toHaveBeenCalledTimes(2)
        expect(tabs.openFile).toHaveBeenNthCalledWith(1, '/ws/flow.mmd')
        expect(tabs.openFile).toHaveBeenNthCalledWith(2, '/ws/docs/notes.md')
    })

    it('renames with F2 and deletes with Delete', () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'F2')
        expect(promptName).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Rename "flow.mmd"',
                description: 'Choose a new name for this file.',
                submitLabel: 'Rename',
                defaultValue: 'flow.mmd',
            })
        )

        press('docs', 'Delete')
        expect(confirmDelete).toHaveBeenCalledWith(tree[0])
    })

    it('opens the row menu with Shift+F10 or the menu key', async () => {
        render(<FileTree tree={tree} />)

        press('flow.mmd', 'F10', { shiftKey: true })
        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    })

    it('ignores keys typed inside an open row menu', async () => {
        render(<FileTree tree={tree} />)
        press('docs', 'ContextMenu')
        const menu = await screen.findByRole('menu')

        fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'ArrowLeft' })

        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
    })

    it('does not collapse a folder when an item in its actions menu is chosen', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('docs', 'New Folder')

        expect(promptName).toHaveBeenCalledTimes(1)
        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
    })

    it('does not open a file when Delete is chosen from its actions menu', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('notes.md', 'Delete')

        expect(confirmDelete).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', path: '/ws/docs/notes.md' }))
        expect(tabs.openFile).not.toHaveBeenCalled()
        expect(session.openFile).not.toHaveBeenCalled()
    })

    it('opens a file once when Open is chosen from its actions menu', async () => {
        render(<FileTree tree={tree} />)

        await chooseFromActionsMenu('notes.md', 'Open')

        expect(session.openFile).toHaveBeenCalledTimes(1)
        expect(tabs.openFile).not.toHaveBeenCalled()
    })

    it('draws again only the rows that changed when focus moves or another file is opened', () => {
        const { rerender } = render(<FileTree tree={tree} />)
        item('docs').focus()
        const drawnRows = () => vi.mocked(isMermaidFile).mock.calls.map(([name]) => name)

        vi.mocked(isMermaidFile).mockClear()
        press('docs', 'ArrowDown')
        // The Tab stop moved from 'docs' (a folder, so not counted) to 'notes.md'.
        expect(drawnRows()).toEqual(['notes.md'])

        vi.mocked(isMermaidFile).mockClear()
        tabs.activeTabId = '/ws/flow.mmd'
        rerender(<FileTree tree={tree} />)
        expect(drawnRows()).toEqual(['flow.mmd'])
    })

    it('does not draw the tree again when the text of a tab changes', () => {
        const onRender = vi.fn()
        render(
            <Profiler id="tree" onRender={onRender}>
                <FileTree tree={tree} />
            </Profiler>
        )
        onRender.mockClear()

        act(() => {
            tabContent.text = 'typed'
            tabContent.listeners.forEach((l) => l())
        })

        expect(onRender).not.toHaveBeenCalled()
    })

    it('keeps the actions button out of the row, so the row is named after the entry only', () => {
        render(<FileTree tree={tree} />)

        expect(item('flow.mmd')).not.toContainElement(screen.getByLabelText('Actions for flow.mmd'))
    })
})

describe('FileTree shows the open file', () => {
    let scrollIntoView: Mock

    beforeEach(() => {
        vi.clearAllMocks()
        tabs.activeTabId = null
        folders.toggles = new Map()
        // The test page lays nothing out, so it has no scrollIntoView of its own.
        scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView
    })

    afterEach(() => {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })

    it('opens the folders that hold the open file, then scrolls to it and marks it', () => {
        folders.toggles = new Map([['/ws/docs', false]])
        tabs.activeTabId = '/ws/docs/notes.md'
        render(<FileTree tree={tree} />)

        expect(session.setFoldersExpanded).toHaveBeenCalledWith(['/ws/docs'], true)
        expect(item('notes.md')).toHaveAttribute('aria-selected', 'true')
        expect(scrollIntoView.mock.contexts).toEqual([item('notes.md')])
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('scrolls to each file as it is opened, without moving focus', () => {
        const { rerender } = render(<FileTree tree={tree} />)
        expect(scrollIntoView).not.toHaveBeenCalled()

        tabs.activeTabId = '/ws/flow.mmd'
        rerender(<FileTree tree={tree} />)

        expect(scrollIntoView.mock.contexts).toEqual([item('flow.mmd')])
        expect(item('flow.mmd')).not.toHaveFocus()
    })

    it('leaves a folder the user closes closed, also when the folder is read again', () => {
        tabs.activeTabId = '/ws/docs/notes.md'
        const { rerender } = render(<FileTree tree={tree} />)

        press('docs', 'ArrowLeft')
        rerender(<FileTree tree={[...tree]} />)

        expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
        expect(session.setFoldersExpanded).not.toHaveBeenCalled()
    })

    it('shows a new file once the tree has it', () => {
        tabs.activeTabId = '/ws/drafts/2026/nov/idea.md'
        const { rerender } = render(<FileTree tree={tree} />)
        expect(scrollIntoView).not.toHaveBeenCalled()

        const drafts: FileNode = {
            kind: 'directory',
            name: 'drafts',
            path: '/ws/drafts',
            children: [
                {
                    kind: 'directory',
                    name: '2026',
                    path: '/ws/drafts/2026',
                    children: [
                        {
                            kind: 'directory',
                            name: 'nov',
                            path: '/ws/drafts/2026/nov',
                            children: [{ kind: 'file', name: 'idea.md', path: '/ws/drafts/2026/nov/idea.md' }],
                        },
                    ],
                },
            ],
        }
        rerender(<FileTree tree={[...tree, drafts]} />)

        // Third-level folders start closed.
        expect(session.setFoldersExpanded).toHaveBeenCalledWith(['/ws/drafts/2026/nov'], true)
        expect(scrollIntoView.mock.contexts).toEqual([item('idea.md')])
    })

    it('shows the open file again when asked, after its folder was closed', () => {
        tabs.activeTabId = '/ws/docs/notes.md'
        render(<FileTree tree={tree} />)
        press('docs', 'ArrowLeft')
        scrollIntoView.mockClear()

        act(() => requestRevealActiveFile())

        expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
        expect(scrollIntoView.mock.contexts).toEqual([item('notes.md')])
    })

    it('does nothing for a tab that is not a file in the folder', () => {
        tabs.activeTabId = 'example:flowchart'
        render(<FileTree tree={tree} />)
        act(() => requestRevealActiveFile())

        expect(session.setFoldersExpanded).not.toHaveBeenCalled()
        expect(scrollIntoView).not.toHaveBeenCalled()
    })
})
