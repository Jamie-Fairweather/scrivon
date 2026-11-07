import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { notifyError, type NotifyOptions } from '@/lib/notify'
import { confirmCloseAfterSaveFailure, confirmUnsavedChanges, showError } from '@/lib/tauri/dialog'
import { PathExistsError } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { addRecentWorkspace, getRecentWorkspaces, getWorkspaceTabSession, removeRecentWorkspace } from '@/lib/tauri/store'
import { DocumentSaveProvider } from './document-save-context'
import { DocumentTabsProvider, useDocumentTabs, useDocumentTabsState } from './document-tabs-context'
import { WorkspaceSessionProvider, useWorkspaceSession } from './workspace-session-context'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from './workspace-coordinator'

const settingsState = vi.hoisted(() => ({ autosave: { enabled: true, delayMs: 400 } }))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: settingsState, setAutosaveEnabled: vi.fn() }),
}))

vi.mock('@/lib/tauri/store', () => ({
    getRecentWorkspaces: vi.fn(async () => []),
    addRecentWorkspace: vi.fn(async (path: string) => [path]),
    removeRecentWorkspace: vi.fn(async () => []),
    getWorkspaceTabSession: vi.fn(async () => null),
    setWorkspaceTabSession: vi.fn(async () => undefined),
    getRecentFiles: vi.fn(async () => []),
    addRecentFile: vi.fn(async () => []),
}))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(() => 'toast'),
}))

vi.mock('@/lib/tauri/dialog', () => ({
    pickWorkspaceFolder: vi.fn(async () => null),
    showError: vi.fn(async () => undefined),
    confirmUnsavedChanges: vi.fn(async () => 'cancel'),
    confirmCloseAfterSaveFailure: vi.fn(async () => 'cancel'),
}))

type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }

/**
 * A tiny in-memory Windows disk: paths match whatever separators or case they use. Like the real
 * plugin, a plain write or a rename replaces whatever is at the target; only createNew refuses.
 */
function createWindowsDisk(files: Record<string, string>) {
    const key = (path: string | URL) => String(path).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    const contents = new Map(Object.entries(files).map(([path, text]) => [key(path), { path, text }]))
    const folders = new Map<string, string>()
    const isFolder = (k: string) => folders.has(k) || [...contents.keys()].some((c) => c.startsWith(`${k}\\`))
    return {
        contents,
        read: async (path: string | URL) => {
            const file = contents.get(key(path))
            if (!file) throw new Error(`not found: ${String(path)}`)
            return file.text
        },
        write: async (path: string | URL, text: string, options?: { createNew?: boolean }) => {
            if (options?.createNew && (contents.has(key(path)) || isFolder(key(path)))) throw 'The file exists. (os error 80)'
            contents.set(key(path), { path: String(path), text })
        },
        readBytes: async (path: string | URL) => {
            const file = contents.get(key(path))
            if (!file) throw new Error(`not found: ${String(path)}`)
            return new TextEncoder().encode(file.text)
        },
        writeBytes: async (path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>, options?: { createNew?: boolean }) => {
            if (options?.createNew && (contents.has(key(path)) || isFolder(key(path)))) throw 'The file exists. (os error 80)'
            contents.set(key(path), { path: String(path), text: new TextDecoder().decode(data as Uint8Array) })
        },
        exists: async (path: string | URL) => contents.has(key(path)) || isFolder(key(path)),
        mkdir: async (path: string | URL) => {
            if (contents.has(key(path)) || isFolder(key(path))) throw 'Cannot create a file when that file already exists. (os error 183)'
            folders.set(key(path), String(path))
        },
        rename: async (from: string | URL, to: string | URL) => {
            const file = contents.get(key(from))
            if (!file) throw new Error(`not found: ${String(from)}`)
            contents.delete(key(from))
            contents.set(key(to), { path: String(to), text: file.text })
        },
        list: async (dir: string): Promise<Entry[]> => {
            if (!isFolder(key(dir)))
                throw `failed to read directory at path: ${dir} with error: The system cannot find the path specified. (os error 3)`
            const prefix = `${key(dir)}\\`
            const names = new Map<string, boolean>()
            const paths = [...[...contents.values()].map((f) => f.path), ...folders.values()]
            for (const path of paths) {
                const normalized = path.replace(/\//g, '\\')
                if (!normalized.toLowerCase().startsWith(prefix)) continue
                const rest = normalized.slice(prefix.length).split('\\')
                names.set(rest[0]!, rest.length > 1 || folders.has(key(normalized)))
            }
            return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }))
        },
    }
}

function mountDisk(disk: ReturnType<typeof createWindowsDisk>) {
    vi.mocked(readTextFile).mockImplementation(disk.read)
    vi.mocked(writeTextFile).mockImplementation(disk.write)
    vi.mocked(readDir).mockImplementation(disk.list as unknown as typeof readDir)
    vi.mocked(exists).mockImplementation(disk.exists)
    vi.mocked(mkdir).mockImplementation(disk.mkdir)
    vi.mocked(rename).mockImplementation(disk.rename)
    vi.mocked(readFile).mockImplementation(disk.readBytes)
    vi.mocked(writeFile).mockImplementation(disk.writeBytes)
}

function useHarness() {
    return { session: useWorkspaceSession(), tabs: useDocumentTabs() }
}

function createWrapper(coordinatorOut: { current?: WorkspaceCoordinatorRefs } = {}) {
    function Inner({ children, coordinator }: { children: ReactNode; coordinator: WorkspaceCoordinatorRefs }) {
        const { workspaceRoot } = useWorkspaceSession()
        const tabsState = useDocumentTabsState()
        return (
            <DocumentTabsProvider coordinator={coordinator} workspaceRoot={workspaceRoot} tabsState={tabsState}>
                <DocumentSaveProvider coordinator={coordinator} tabsRef={tabsState.tabsRef} setTabs={tabsState.setTabs}>
                    {children}
                </DocumentSaveProvider>
            </DocumentTabsProvider>
        )
    }
    return function Wrapper({ children }: { children: ReactNode }) {
        const coordinator = useMemo(() => createWorkspaceCoordinatorRefs(), [])
        coordinatorOut.current = coordinator
        return (
            <WorkspaceSessionProvider coordinator={coordinator}>
                <Inner coordinator={coordinator}>{children}</Inner>
            </WorkspaceSessionProvider>
        )
    }
}

describe('WorkspaceSessionProvider on Windows paths', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\sub\\a.mmd': 'graph TD' })
        mountDisk(disk)
    })

    it('gives a created file one tab, even when it is then opened from the tree', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'flow.mmd', 'graph LR')
        })

        const treeNode = result.current.session.tree.find((node) => node.name === 'flow.mmd')
        expect(treeNode?.path).toBe('C:\\ws\\flow.mmd')
        expect(result.current.tabs.activeTabId).toBe(treeNode?.path)

        await act(async () => {
            await result.current.tabs.openFile(treeNode!.path)
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws/flow.mmd')
        })

        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\flow.mmd'])
    })

    it('closes the tab of a deleted file and remaps a twice-renamed file', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        const sub = result.current.session.tree.find((node) => node.name === 'sub')
        const file = sub?.kind === 'directory' ? sub.children[0] : undefined
        expect(file?.path).toBe('C:\\ws\\sub\\a.mmd')

        await act(async () => {
            await result.current.tabs.openFile(file!.path)
        })
        await act(async () => {
            await result.current.session.renameEntry(file!.path, 'b.mmd', false)
        })
        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\sub\\b.mmd', 'c.mmd', false)
        })

        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\sub\\c.mmd'])
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\sub\\c.mmd')

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws/sub', true)
        })
        expect(result.current.tabs.tabs).toEqual([])
    })

    it('restores a saved session with mixed separators as one tab per file', async () => {
        vi.mocked(getWorkspaceTabSession).mockResolvedValueOnce({
            tabIds: ['C:\\ws/sub/a.mmd', 'C:\\ws\\sub\\a.mmd'],
            activeTabId: 'C:\\ws/sub/a.mmd',
        })
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws\\')
        })

        await waitFor(() => {
            expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\sub\\a.mmd'])
        })
        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\sub\\a.mmd')
    })
})

describe('leaving a folder with unsaved edits', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        // A long delay keeps the autosave timer out of the way; leaving the folder saves on its own.
        settingsState.autosave = { enabled: true, delayMs: 60_000 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\a.mmd': 'graph TD', 'D:\\other\\b.mmd': 'graph LR' })
        mountDisk(disk)
    })

    async function openAndEdit(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\a.mmd')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\a.mmd', 'MY EDITS'))
    }

    it('keeps the folder and its edits open when saving fails and the user cancels', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openAndEdit(result)
        vi.mocked(writeTextFile).mockRejectedValue('Access is denied. (os error 5)')

        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        await act(async () => {
            await result.current.session.openWorkspace('D:\\other')
        })

        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledTimes(2)
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledWith([{ name: 'a.mmd', error: 'Access is denied. (os error 5)' }])
        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.tabs.tabs).toEqual([expect.objectContaining({ content: 'MY EDITS', isDirty: true })])
    })

    it('closes the folder without saving only when the user chooses to', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openAndEdit(result)
        vi.mocked(writeTextFile).mockRejectedValue('Access is denied. (os error 5)')
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('discard')

        await act(async () => {
            await result.current.session.closeWorkspace()
        })

        expect(result.current.session.workspaceRoot).toBeNull()
        expect(result.current.tabs.tabs).toEqual([])
    })

    it('saves the edits and switches folders when saving works', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openAndEdit(result)

        await act(async () => {
            await result.current.session.openWorkspace('D:\\other')
        })

        expect(await disk.read('C:\\ws\\a.mmd')).toBe('MY EDITS')
        expect(confirmCloseAfterSaveFailure).not.toHaveBeenCalled()
        expect(result.current.session.workspaceRoot).toBe('D:\\other')
    })

    it('asks Save / Don’t Save / Cancel with autosave off instead of writing silently', async () => {
        settingsState.autosave = { enabled: false, delayMs: 400 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openAndEdit(result)
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard')

        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        expect(confirmUnsavedChanges).toHaveBeenCalledWith(['a.mmd'])
        expect(result.current.session.workspaceRoot).toBe('C:\\ws')

        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        expect(result.current.session.workspaceRoot).toBeNull()
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\a.mmd')).toBe('graph TD')
    })
})

describe('creating files and folders', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\diagram.mmd': 'MY WORK', 'C:\\ws\\docs\\notes.md': '# Notes' })
        mountDisk(disk)
    })

    async function openWorkspace(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
    }

    it('refuses a name already used in the folder, in any letter case, instead of overwriting it', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'diagram.mmd')
        })
        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'DIAGRAM.mmd')
        })

        expect(await disk.read('C:\\ws\\diagram.mmd')).toBe('MY WORK')
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith("Couldn't create diagram.mmd", undefined, {
            description: 'A file named "diagram.mmd" already exists here.',
        })
        expect(result.current.tabs.tabs).toEqual([])
    })

    it('refuses a file that appeared on disk after the tree was read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        await disk.write('C:\\ws\\late.mmd', 'MADE ELSEWHERE')
        vi.mocked(writeTextFile).mockClear()

        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'late.mmd')
        })

        expect(await disk.read('C:\\ws\\late.mmd')).toBe('MADE ELSEWHERE')
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith("Couldn't create late.mmd", expect.any(PathExistsError))
    })

    it('creates and opens a new file when the name is free', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFile('C:\\ws\\docs', 'diagram.mmd', 'graph LR')
        })

        expect(await disk.read('C:\\ws\\docs\\diagram.mmd')).toBe('graph LR')
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\docs\\diagram.mmd')
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('refuses a folder name that is already taken', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFolder('C:\\ws', 'Docs')
        })

        expect(mkdir).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith("Couldn't create folder Docs", undefined, {
            description: 'A folder named "docs" already exists here.',
        })
    })

    it('refuses folder names Windows would reject or change, and says why', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFolder('C:\\ws', 'aux')
        })
        await act(async () => {
            await result.current.session.createFolder('C:\\ws', 'drafts.')
        })

        expect(mkdir).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith("Couldn't create folder aux", undefined, { description: '"aux" is a reserved name on Windows' })
        expect(notifyError).toHaveBeenCalledWith("Couldn't create folder drafts.", undefined, { description: 'Name cannot end with a dot' })
    })

    it('suggests a default name nothing in the folder uses', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        expect(result.current.session.suggestName('C:\\ws', 'diagram.mmd')).toBe('diagram 2.mmd')
        expect(result.current.session.suggestName('C:\\ws\\docs', 'diagram.mmd')).toBe('diagram.mmd')
        expect(result.current.session.suggestName('C:\\ws', 'docs')).toBe('docs 2')
    })

    it('says why a name can’t be used, for the name prompt to show as the user types', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        const { getNameError } = result.current.session

        expect(getNameError('C:\\ws', 'Diagram.mmd', 'file')).toBe('A file named "diagram.mmd" already exists here.')
        expect(getNameError('C:\\ws', 'my:flow.mmd', 'file')).toBe('Name contains invalid characters')
        expect(getNameError('C:\\ws', 'notes', 'file')).toBe('File name must end with .md, .mmd or .mermaid.')
        expect(getNameError('C:\\ws\\docs', 'diagram.mmd', 'file')).toBeNull()
        expect(getNameError('C:\\ws', 'Diagram.mmd', 'file', 'C:\\ws\\diagram.mmd')).toBeNull()
    })

    it('reports a bad name in a notice instead of a blocking message box', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'my:flow.mmd')
        })

        expect(showError).not.toHaveBeenCalled()
        expect(writeTextFile).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith("Couldn't create my:flow.mmd", undefined, { description: 'Name contains invalid characters' })
    })
})

describe('renaming', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\draft.md': 'DRAFT', 'C:\\ws\\final.md': 'FINAL' })
        mountDisk(disk)
    })

    async function openWithDraftTab(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\draft.md')
        })
    }

    it('refuses to rename onto a name another file uses, in any letter case', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWithDraftTab(result)

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\draft.md', 'final.md', false)
        })
        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\draft.md', 'FINAL.md', false)
        })

        expect(rename).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\final.md')).toBe('FINAL')
        expect(await disk.read('C:\\ws\\draft.md')).toBe('DRAFT')
        expect(notifyError).toHaveBeenCalledWith("Couldn't rename draft.md", undefined, {
            description: 'A file named "final.md" already exists here.',
        })
        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\draft.md'])
    })

    it('refuses a target that appeared on disk after the tree was read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWithDraftTab(result)
        await disk.write('C:\\ws\\late.md', 'MADE ELSEWHERE')

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\draft.md', 'late.md', false)
        })

        expect(rename).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\late.md')).toBe('MADE ELSEWHERE')
        expect(notifyError).toHaveBeenCalledWith("Couldn't rename draft.md", expect.any(PathExistsError))
    })

    it('still allows a change of letter case only', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWithDraftTab(result)

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\draft.md', 'Draft.md', false)
        })

        expect(rename).toHaveBeenCalledWith('C:\\ws\\draft.md', 'C:\\ws\\Draft.md')
        expect(result.current.tabs.tabs.map((t) => t.name)).toEqual(['Draft.md'])
        expect(notifyError).not.toHaveBeenCalled()
    })
})

describe('file system errors', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\sub\\a.mmd': 'graph TD' })
        mountDisk(disk)
    })

    async function openWorkspace(result: { current: ReturnType<typeof useHarness> }, path = 'C:\\ws') {
        await act(async () => {
            await result.current.session.openWorkspace(path)
        })
    }

    it('says why a delete failed and keeps the tabs of what is still there', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\sub\\a.mmd')
        })
        vi.mocked(remove).mockRejectedValueOnce('The directory is not empty. (os error 145)')

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\sub', true)
        })

        expect(notifyError).toHaveBeenCalledWith("Couldn't delete sub", 'The directory is not empty. (os error 145)')
        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\sub\\a.mmd'])
    })

    it('says a recent folder could not be opened, keeps the open one, and offers to drop it from the list', async () => {
        vi.mocked(getRecentWorkspaces).mockResolvedValueOnce(['D:\\gone'])
        vi.mocked(addRecentWorkspace).mockResolvedValueOnce(['C:\\ws', 'D:\\gone'])
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.hydrated).toBe(true))
        await openWorkspace(result)

        await openWorkspace(result, 'D:\\gone')

        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.session.tree.map((n) => n.name)).toEqual(['sub'])
        expect(notifyError).toHaveBeenCalledWith("Couldn't open gone", expect.anything(), {
            action: { label: 'Remove from Recent', onClick: expect.any(Function) },
        })
        const options = vi.mocked(notifyError).mock.calls.at(-1)![2] as NotifyOptions
        await act(async () => {
            options.action!.onClick()
        })
        expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\gone')
    })

    it('still opens a created file when the file list fails to reload', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        vi.mocked(readDir).mockRejectedValueOnce('Access is denied. (os error 5)')

        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'flow.mmd', 'graph LR')
        })

        expect(await disk.read('C:\\ws\\flow.mmd')).toBe('graph LR')
        expect(notifyError).toHaveBeenCalledWith("Couldn't refresh the file list", 'Access is denied. (os error 5)')
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\flow.mmd')
    })

    it('says why a duplicate failed', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        vi.mocked(readFile).mockRejectedValueOnce('The process cannot access the file because it is being used by another process. (os error 32)')

        await act(async () => {
            await result.current.session.duplicateFile('C:\\ws\\sub\\a.mmd')
        })

        expect(notifyError).toHaveBeenCalledWith(
            "Couldn't duplicate a.mmd",
            'The process cannot access the file because it is being used by another process. (os error 32)'
        )
        expect(result.current.tabs.tabs).toEqual([])
    })
})

describe('duplicating', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({
            'C:\\ws\\notes.md': 'SAVED',
            'C:\\ws\\Notes copy.md': 'OTHER WORK',
            'C:\\ws\\other\\notes copy 2.md': 'IN ANOTHER FOLDER',
        })
        mountDisk(disk)
    })

    async function openWorkspace(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
    }

    it('picks a name no file in the folder uses, ignoring letter case and other folders', async () => {
        settingsState.autosave = { enabled: true, delayMs: 400 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.duplicateFile('C:\\ws\\notes.md')
        })

        expect(await disk.read('C:\\ws\\Notes copy.md')).toBe('OTHER WORK')
        expect(await disk.read('C:\\ws\\notes copy 2.md')).toBe('SAVED')
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\notes copy 2.md')
    })

    it('sees a copy made outside the app since the tree was read, instead of overwriting it', async () => {
        settingsState.autosave = { enabled: true, delayMs: 400 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        await disk.write('C:\\ws\\notes copy 2.md', 'MADE ELSEWHERE')

        await act(async () => {
            await result.current.session.duplicateFile('C:\\ws\\notes.md')
        })

        expect(await disk.read('C:\\ws\\notes copy 2.md')).toBe('MADE ELSEWHERE')
        expect(await disk.read('C:\\ws\\notes copy 3.md')).toBe('SAVED')
    })

    it('copies the unsaved edits the user sees, without saving the original', async () => {
        settingsState.autosave = { enabled: false, delayMs: 400 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'UNSAVED EDITS'))

        await act(async () => {
            await result.current.session.duplicateFile('C:\\ws\\notes.md')
        })

        expect(await disk.read('C:\\ws\\notes copy 2.md')).toBe('UNSAVED EDITS')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('SAVED')
        expect(result.current.tabs.tabs.find((t) => t.id === 'C:\\ws\\notes.md')).toMatchObject({ isDirty: true, content: 'UNSAVED EDITS' })
    })
})
