import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exists, lstat, mkdir, readDir, readFile, readTextFile, remove, rename, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { dismissNotification, notifyError, notifyInfo, notifyWarning, type NotifyOptions } from '@/lib/notify'
import { confirmCloseAfterSaveFailure, confirmOverwriteDiskChange, confirmUnsavedChanges, showError } from '@/lib/tauri/dialog'
import { deleteUnsavedBackup, listUnsavedBackups, saveUnsavedBackup, type UnsavedBackup } from '@/lib/tauri/backups'
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

vi.mock('@/lib/tauri/backups', () => ({
    saveUnsavedBackup: vi.fn(async () => undefined),
    deleteUnsavedBackup: vi.fn(async () => undefined),
    listUnsavedBackups: vi.fn(async () => []),
}))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(() => 'toast'),
    notifyWarning: vi.fn(() => 'toast'),
    notifyInfo: vi.fn(() => 'toast'),
    dismissNotification: vi.fn(),
}))

vi.mock('@/lib/tauri/dialog', () => ({
    pickWorkspaceFolder: vi.fn(async () => null),
    showError: vi.fn(async () => undefined),
    confirmUnsavedChanges: vi.fn(async () => 'cancel'),
    confirmCloseAfterSaveFailure: vi.fn(async () => 'cancel'),
    confirmOverwriteDiskChange: vi.fn(async () => false),
}))

const windowFocus = vi.hoisted(() => ({ handler: undefined as undefined | ((event: { payload: boolean }) => void) }))

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
            windowFocus.handler = handler
            return () => {
                if (windowFocus.handler === handler) windowFocus.handler = undefined
            }
        },
    }),
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
    // Each write gets a later modified time; a rename keeps it, like a real disk.
    let clock = 1
    const mtimes = new Map<string, number>()
    const touch = (path: string | URL) => mtimes.set(key(path), ++clock)
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
            touch(path)
        },
        readBytes: async (path: string | URL) => {
            const file = contents.get(key(path))
            if (!file) throw new Error(`not found: ${String(path)}`)
            return new TextEncoder().encode(file.text)
        },
        writeBytes: async (path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>, options?: { createNew?: boolean }) => {
            if (options?.createNew && (contents.has(key(path)) || isFolder(key(path)))) throw 'The file exists. (os error 80)'
            contents.set(key(path), { path: String(path), text: new TextDecoder().decode(data as Uint8Array) })
            touch(path)
        },
        stat: async (path: string | URL) => {
            const file = contents.get(key(path))
            if (file) {
                const size = new TextEncoder().encode(file.text).length
                return { isFile: true, isDirectory: false, isSymlink: false, size, mtime: new Date(mtimes.get(key(path)) ?? 1), nlink: null }
            }
            if (isFolder(key(path))) return { isFile: false, isDirectory: true, isSymlink: false, size: 0, mtime: null, nlink: null }
            throw 'The system cannot find the file specified. (os error 2)'
        },
        exists: async (path: string | URL) => contents.has(key(path)) || isFolder(key(path)),
        mkdir: async (path: string | URL) => {
            if (contents.has(key(path)) || isFolder(key(path))) throw 'Cannot create a file when that file already exists. (os error 183)'
            folders.set(key(path), String(path))
        },
        /** Like plugin-fs: a folder that isn't empty is only removed with `recursive`. */
        remove: async (path: string | URL, options?: { recursive?: boolean }) => {
            const k = key(path)
            if (contents.delete(k)) return
            if (!isFolder(k)) throw new Error(`not found: ${String(path)}`)
            const inside = [...contents.keys(), ...folders.keys()].filter((c) => c.startsWith(`${k}\\`))
            if (inside.length > 0 && !options?.recursive) throw 'The directory is not empty. (os error 145)'
            for (const c of inside) {
                contents.delete(c)
                folders.delete(c)
            }
            folders.delete(k)
        },
        rename: async (from: string | URL, to: string | URL) => {
            const file = contents.get(key(from))
            if (!file) throw new Error(`not found: ${String(from)}`)
            contents.delete(key(from))
            contents.set(key(to), { path: String(to), text: file.text })
            mtimes.set(key(to), mtimes.get(key(from)) ?? 1)
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
    vi.mocked(remove).mockImplementation(disk.remove)
    vi.mocked(readFile).mockImplementation(disk.readBytes)
    vi.mocked(writeFile).mockImplementation(disk.writeBytes)
    vi.mocked(stat).mockImplementation(disk.stat as unknown as typeof stat)
    vi.mocked(lstat).mockImplementation(disk.stat as unknown as typeof lstat)
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
                <DocumentSaveProvider coordinator={coordinator} tabsRef={tabsState.tabsRef} setTabs={tabsState.setTabs} workspaceRoot={workspaceRoot}>
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

        // The folder still holds c.mmd, so this only works when the delete is recursive.
        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws/sub', true)
        })
        expect(result.current.tabs.tabs).toEqual([])
        expect(await disk.exists('C:\\ws\\sub\\c.mmd')).toBe(false)
        expect(notifyError).not.toHaveBeenCalledWith("Couldn't delete sub", expect.anything())
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

    it('reopens a saved tab for a file that is not UTF-8 as read-only, and says why', async () => {
        vi.mocked(getWorkspaceTabSession).mockResolvedValueOnce({ tabIds: ['C:\\ws\\sub\\a.mmd'], activeTabId: 'C:\\ws\\sub\\a.mmd' })
        vi.mocked(readFile).mockResolvedValueOnce(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })

        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'Café', readOnly: true }))
        expect(notifyWarning).toHaveBeenCalledWith('a.mmd is read-only', expect.objectContaining({ id: 'read-only:C:\\ws\\sub\\a.mmd' }))
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
        vi.mocked(writeFile).mockRejectedValue('Access is denied. (os error 5)')

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
        vi.mocked(writeFile).mockRejectedValue('Access is denied. (os error 5)')
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
        expect(writeFile).not.toHaveBeenCalled()
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

    it('opens the new file without waiting for the file list to be read again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)
        // A big folder: reading the file list again takes as long as the test wants.
        let finishListing!: () => void
        const listed = new Promise<void>((resolve) => (finishListing = resolve))
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            await listed
            return disk.list(dir)
        }) as unknown as typeof readDir)

        let creating!: Promise<void>
        act(() => {
            creating = result.current.session.createFile('C:\\ws', 'flow.mmd', 'graph LR')
        })
        await waitFor(() => expect(result.current.tabs.activeTabId).toBe('C:\\ws\\flow.mmd'))
        expect(result.current.session.tree.map((node) => node.name)).not.toContain('flow.mmd')

        await act(async () => {
            finishListing()
            await creating
        })
        expect(result.current.session.tree.map((node) => node.name)).toContain('flow.mmd')
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

    it('opens a folder with a subfolder it cannot read, and says which one shows as empty', async () => {
        const list = disk.list
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (dir === 'C:\\ws\\sub') throw 'Access is denied. (os error 5)'
            return list(dir)
        }) as unknown as typeof readDir)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await openWorkspace(result)

        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.session.tree).toEqual([{ kind: 'directory', name: 'sub', path: 'C:\\ws\\sub', children: [], unreadable: true }])
        expect(notifyWarning).toHaveBeenCalledWith("Couldn't read the folder sub", {
            description: 'It shows as empty. Scrivon may not have permission to open it.',
        })
        expect(notifyError).not.toHaveBeenCalled()
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

describe('changes made outside Scrivon', () => {
    let disk: ReturnType<typeof createWindowsDisk>
    const coordinatorOut: { current?: WorkspaceCoordinatorRefs } = {}

    beforeEach(() => {
        vi.clearAllMocks()
        // A long delay keeps the autosave timer out of the way; the tests save when they choose to.
        settingsState.autosave = { enabled: true, delayMs: 60_000 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValue(false)
        disk = createWindowsDisk({ 'C:\\ws\\notes.md': 'mine v1' })
        mountDisk(disk)
    })

    async function openAndEdit(result: { current: ReturnType<typeof useHarness> }, text = 'MY EDITS') {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', text))
    }

    async function save() {
        let ok!: boolean
        await act(async () => {
            ok = await coordinatorOut.current!.flushSave.current('C:\\ws\\notes.md')
        })
        return ok
    }

    it('saves again and again without asking when nothing else touched the file', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await expect(save()).resolves.toBe(true)
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS 2'))
        await expect(save()).resolves.toBe(true)

        expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS 2')
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
    })

    it('asks before saving over a change made in another app, and keeps that change when told to', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await disk.write('C:\\ws\\notes.md', 'edited in VS Code')

        await expect(save()).resolves.toBe(false)

        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'changed')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('edited in VS Code')
        expect(result.current.tabs.tabs[0]).toMatchObject({
            content: 'MY EDITS',
            isDirty: true,
            saveError: 'It was changed outside Scrivon since you opened it.',
        })
        expect(notifyError).toHaveBeenCalledWith("Couldn't save notes.md", expect.anything(), expect.objectContaining({ timeout: 0 }))

        // Typing doesn't ask again after every pause; switching tabs doesn't either.
        act(() => coordinatorOut.current!.flushSaveOnTabLeave.current('C:\\ws\\notes.md'))
        expect(confirmOverwriteDiskChange).toHaveBeenCalledTimes(1)

        // Try Again on the notice asks once more, and Overwrite saves.
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce(true)
        await expect(save()).resolves.toBe(true)
        expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS')
        expect(result.current.tabs.tabs[0]).toMatchObject({ isDirty: false, saveError: undefined })

        // The overwrite is now the version the tab knows, so the next save doesn't ask.
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS 2'))
        await expect(save()).resolves.toBe(true)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledTimes(2)
    })

    it('asks before bringing back a file deleted in another app', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        disk.contents.clear()

        await expect(save()).resolves.toBe(false)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'deleted')
        expect(await disk.exists('C:\\ws\\notes.md')).toBe(false)

        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce(true)
        await expect(save()).resolves.toBe(true)
        expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS')
    })

    it('shows files added in another app when the window gets focus again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        await disk.write('C:\\ws\\from-git.md', '# new')

        await act(async () => {
            windowFocus.handler!({ payload: false })
        })
        expect(result.current.session.tree.map((n) => n.name)).toEqual(['notes.md'])

        await act(async () => {
            windowFocus.handler!({ payload: true })
        })
        await waitFor(() => expect(result.current.session.tree.map((n) => n.name)).toEqual(['from-git.md', 'notes.md']))
    })
})

describe('unsaved text kept from a crash', () => {
    let disk: ReturnType<typeof createWindowsDisk>
    const coordinatorOut: { current?: WorkspaceCoordinatorRefs } = {}

    // What the disk mock reports for a file that hasn't been written since the test began.
    const untouched = (text: string) => ({ mtimeMs: 1, size: new TextEncoder().encode(text).length })

    function kept(path: string, content: string, overrides: Partial<UnsavedBackup> = {}): UnsavedBackup {
        return { path, root: 'C:\\ws', content, stamp: untouched('on disk'), savedAt: 1, ...overrides }
    }

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: false, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValue(false)
        disk = createWindowsDisk({ 'C:\\ws\\notes.md': 'on disk', 'C:\\ws\\other.md': 'same' })
        mountDisk(disk)
    })

    afterEach(() => {
        vi.mocked(listUnsavedBackups).mockReset()
        vi.mocked(listUnsavedBackups).mockResolvedValue([])
    })

    async function open(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
    }

    async function save(path: string) {
        let ok!: boolean
        await act(async () => {
            ok = await coordinatorOut.current!.flushSave.current(path)
        })
        return ok
    }

    it('reopens the file with the unsaved text, not saved yet, and says so', async () => {
        vi.mocked(listUnsavedBackups).mockResolvedValue([kept('C:\\ws\\notes.md', 'typed before the crash')])
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await open(result)

        expect(result.current.tabs.tabs).toEqual([
            expect.objectContaining({ id: 'C:\\ws\\notes.md', content: 'typed before the crash', isDirty: true }),
        ])
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\notes.md')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('on disk')
        expect(notifyWarning).toHaveBeenCalledWith(
            'Recovered unsaved changes',
            expect.objectContaining({ id: 'recovered-changes', timeout: 0, description: expect.stringContaining('notes.md') })
        )

        await expect(save('C:\\ws\\notes.md')).resolves.toBe(true)
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\notes.md')).toBe('typed before the crash')
        expect(deleteUnsavedBackup).toHaveBeenCalledWith('C:\\ws\\notes.md')
    })

    it('asks before saving the recovered text over a file changed in another app since', async () => {
        vi.mocked(listUnsavedBackups).mockResolvedValue([kept('C:\\ws\\notes.md', 'mine', { stamp: untouched('older') })])
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await open(result)

        await expect(save('C:\\ws\\notes.md')).resolves.toBe(false)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'changed')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('on disk')
        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'mine', isDirty: true })
    })

    it('brings the text back even when the file was deleted since, and asks before saving it there again', async () => {
        vi.mocked(listUnsavedBackups).mockResolvedValue([kept('C:\\ws\\gone.md', 'only copy')])
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await open(result)

        expect(result.current.tabs.tabs).toEqual([expect.objectContaining({ id: 'C:\\ws\\gone.md', content: 'only copy', isDirty: true })])
        await expect(save('C:\\ws\\gone.md')).resolves.toBe(false)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('gone.md', 'deleted')
    })

    it('leaves other folders alone and forgets a copy that is already on disk', async () => {
        vi.mocked(listUnsavedBackups).mockResolvedValue([
            kept('D:\\elsewhere\\x.md', 'not this folder', { root: 'D:\\elsewhere' }),
            kept('C:\\ws\\other.md', 'same'),
        ])
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await open(result)

        expect(result.current.tabs.tabs).toEqual([expect.objectContaining({ id: 'C:\\ws\\other.md', content: 'same', isDirty: false })])
        expect(deleteUnsavedBackup).toHaveBeenCalledWith('C:\\ws\\other.md')
        expect(notifyWarning).not.toHaveBeenCalledWith('Recovered unsaved changes', expect.anything())
    })

    it('offers to open the folder with unsaved changes when the app starts', async () => {
        vi.mocked(listUnsavedBackups).mockResolvedValue([kept('C:\\ws\\notes.md', 'typed before the crash')])
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })

        await waitFor(() =>
            expect(notifyWarning).toHaveBeenCalledWith(
                'Unsaved changes from last time',
                expect.objectContaining({ id: 'recovered-changes', action: expect.objectContaining({ label: 'Open Folder' }) })
            )
        )
        const options = vi.mocked(notifyWarning).mock.calls.find((call) => call[0] === 'Unsaved changes from last time')![1] as NotifyOptions
        expect(options.description).toContain('notes.md in ws')

        await act(async () => {
            options.action!.onClick()
        })
        await waitFor(() => expect(result.current.session.workspaceRoot).toBe('C:\\ws'))
        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'typed before the crash', isDirty: true }))
    })

    it('moves the copy with the file when it is renamed', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await open(result)
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'unsaved'))

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\notes.md', 'renamed.md', false)
        })

        expect(deleteUnsavedBackup).toHaveBeenCalledWith('C:\\ws\\notes.md')
        await waitFor(
            () =>
                expect(saveUnsavedBackup).toHaveBeenCalledWith(
                    expect.objectContaining({ path: 'C:\\ws\\renamed.md', content: 'unsaved', root: 'C:\\ws' })
                ),
            { timeout: 3000 }
        )
    })
})

describe('opening folders one after another', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 60_000 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({
            'C:\\big\\a.md': 'A',
            'C:\\small\\b.md': 'B',
            'C:\\ws\\notes.md': 'mine',
            'C:\\ws\\other.md': 'other',
        })
        mountDisk(disk)
    })

    afterEach(() => {
        vi.mocked(getWorkspaceTabSession).mockReset()
        vi.mocked(getWorkspaceTabSession).mockResolvedValue(null)
    })

    /** Makes reading the file list of `folder` wait until the test lets it finish. */
    function slowFolder(folder: string) {
        let finish!: () => void
        const done = new Promise<void>((resolve) => (finish = resolve))
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (String(dir).toLowerCase().startsWith(folder.toLowerCase())) await done
            return disk.list(String(dir))
        }) as unknown as typeof readDir)
        return finish
    }

    it('opens the folder clicked last, even when an earlier one finishes reading later', async () => {
        vi.mocked(getWorkspaceTabSession).mockImplementation(async (root: string) =>
            root === 'C:\\big' ? { tabIds: ['C:\\big\\a.md'], activeTabId: 'C:\\big\\a.md' } : { tabIds: ['C:\\small\\b.md'], activeTabId: null }
        )
        const finishBig = slowFolder('C:\\big')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        let openingBig!: Promise<void>
        act(() => {
            openingBig = result.current.session.openWorkspace('C:\\big')
        })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\small')
        })
        expect(result.current.session.workspaceRoot).toBe('C:\\small')

        await act(async () => {
            finishBig()
            await openingBig
        })

        expect(result.current.session.workspaceRoot).toBe('C:\\small')
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['b.md'])
        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\small\\b.md'])
        expect(result.current.session.openingWorkspace).toBeNull()
    })

    it('saves what was typed in the open folder while the next one was being read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        const finishBig = slowFolder('C:\\big')

        let opening!: Promise<void>
        act(() => {
            opening = result.current.session.openWorkspace('C:\\big')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'typed while waiting'))
        await act(async () => {
            finishBig()
            await opening
        })

        expect(result.current.session.workspaceRoot).toBe('C:\\big')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('typed while waiting')
    })

    it('says when a folder is slow to open, and clears that once it is open', async () => {
        const finishBig = slowFolder('C:\\big')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        let opening!: Promise<void>
        act(() => {
            opening = result.current.session.openWorkspace('C:\\big')
        })
        expect(result.current.session.openingWorkspace).toBe('C:\\big')
        await waitFor(() => expect(notifyInfo).toHaveBeenCalledWith('Opening big…', expect.objectContaining({ id: 'opening-folder', timeout: 0 })))

        await act(async () => {
            finishBig()
            await opening
        })
        expect(dismissNotification).toHaveBeenCalledWith('opening-folder')
        expect(result.current.session.openingWorkspace).toBeNull()
        expect(result.current.session.workspaceRoot).toBe('C:\\big')
    })

    it('drops a folder still being opened when the open one is closed', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        const finishBig = slowFolder('C:\\big')

        let opening!: Promise<void>
        act(() => {
            opening = result.current.session.openWorkspace('C:\\big')
        })
        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        await act(async () => {
            finishBig()
            await opening
        })

        expect(result.current.session.workspaceRoot).toBeNull()
        expect(result.current.session.openingWorkspace).toBeNull()
    })

    it('keeps a file the user opened while the saved tabs were still loading', async () => {
        vi.mocked(getWorkspaceTabSession).mockResolvedValue({ tabIds: ['C:\\ws\\notes.md'], activeTabId: 'C:\\ws\\notes.md' })
        let finishNotes!: () => void
        const notesRead = new Promise<void>((resolve) => (finishNotes = resolve))
        vi.mocked(readFile).mockImplementation(async (path) => {
            if (String(path).endsWith('notes.md')) await notesRead
            return disk.readBytes(path)
        })
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        let opening!: Promise<void>
        act(() => {
            opening = result.current.session.openWorkspace('C:\\ws')
        })
        await waitFor(() => expect(result.current.session.workspaceRoot).toBe('C:\\ws'))
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\other.md')
        })
        await act(async () => {
            finishNotes()
            await opening
        })

        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\notes.md', 'C:\\ws\\other.md'])
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\other.md')
    })
})
