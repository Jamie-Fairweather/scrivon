import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    exists,
    lstat,
    mkdir,
    readDir,
    readFile,
    readTextFile,
    remove,
    rename,
    stat,
    watchImmediate,
    writeFile,
    writeTextFile,
    type WatchEvent,
} from '@tauri-apps/plugin-fs'
import { dismissNotification, notifyError, notifyInfo, notifySuccess, notifyWarning, type NotifyOptions } from '@/lib/notify'
import {
    confirmCloseAfterSaveFailure,
    confirmDeleteHiddenFolders,
    confirmKeptChangesWithoutFolder,
    confirmOpenLargeFile,
    confirmUnsavedChanges,
    pickWorkspaceFolder,
    showError,
} from '@/lib/tauri/dialog'
import { confirmOverwriteDiskChange } from '@/components/studio/dialogs/disk-change-dialog'
import { deleteUnsavedBackup, listUnsavedBackups, saveUnsavedBackup, type UnsavedBackup } from '@/lib/tauri/backups'
import { PathExistsError } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import {
    addRecentWorkspace,
    getFolderToggles,
    getLastWorkspace,
    getRecentWorkspaces,
    getWorkspaceTabSession,
    removeRecentFiles,
    removeRecentWorkspace,
    renameRecentFiles,
    setFolderToggles,
    setLastWorkspace,
} from '@/lib/tauri/store'
import type { FileNode } from '@/lib/workspace/types'
import { DocumentSaveProvider } from './document-save-context'
import { DocumentTabsProvider, useDocumentTabs, useDocumentTabsState } from './document-tabs-context'
import { WorkspaceSessionProvider, useWorkspaceSession } from './workspace-session-context'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from './workspace-coordinator'

const settingsState = vi.hoisted(() => ({
    autosave: { enabled: true, delayMs: 400 },
    workspace: { maxRecentFolders: 10 } as { maxRecentFolders: number; reopenLastFolder?: boolean },
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: settingsState, setAutosaveEnabled: vi.fn() }),
}))

vi.mock('@/lib/tauri/store', () => ({
    getRecentWorkspaces: vi.fn(async () => []),
    addRecentWorkspace: vi.fn(async (path: string) => [path]),
    clampRecentWorkspaceLimit: (limit: number) => limit,
    removeRecentWorkspace: vi.fn(async () => []),
    getWorkspaceTabSession: vi.fn(async () => null),
    setWorkspaceTabSession: vi.fn(async () => undefined),
    getRecentFiles: vi.fn(async () => []),
    addRecentFile: vi.fn(async () => []),
    renameRecentFiles: vi.fn(async () => []),
    removeRecentFiles: vi.fn(async () => []),
    getFolderToggles: vi.fn(async () => []),
    setFolderToggles: vi.fn(async () => undefined),
    getLastWorkspace: vi.fn(async () => null),
    setLastWorkspace: vi.fn(async () => undefined),
}))

vi.mock('@/lib/tauri/backups', () => ({
    saveUnsavedBackup: vi.fn(async () => undefined),
    deleteUnsavedBackup: vi.fn(async () => undefined),
    listUnsavedBackups: vi.fn(async () => []),
    settleUnsavedBackups: vi.fn(async () => undefined),
}))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(() => 'toast'),
    notifyWarning: vi.fn(() => 'toast'),
    notifyInfo: vi.fn(() => 'toast'),
    notifySuccess: vi.fn(() => 'toast'),
    dismissNotification: vi.fn(),
}))

vi.mock('@/lib/tauri/dialog', () => ({
    pickWorkspaceFolder: vi.fn(async () => null),
    showError: vi.fn(async () => undefined),
    confirmUnsavedChanges: vi.fn(async () => 'cancel'),
    confirmCloseAfterSaveFailure: vi.fn(async () => 'cancel'),
    confirmDeleteHiddenFolders: vi.fn(async () => false),
    confirmKeptChangesWithoutFolder: vi.fn(async () => 'keep'),
    confirmOpenLargeFile: vi.fn(async () => false),
}))

vi.mock('@/components/studio/dialogs/disk-change-dialog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/studio/dialogs/disk-change-dialog')>()),
    confirmOverwriteDiskChange: vi.fn(async () => 'keep' as const),
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

    it('starts a new document with a heading named after the file', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFile('C:\\ws', 'meeting-notes.md')
        })

        expect(await disk.read('C:\\ws\\meeting-notes.md')).toBe('# Meeting notes\n\n')
        expect(result.current.tabs.activeTab?.content).toBe('# Meeting notes\n\n')
    })

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

    it('shows a new build folder, and says why a folder the file list leaves out seems to vanish', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.createFolder('C:\\ws', 'build')
        })
        expect(result.current.session.tree.map((node) => node.name)).toContain('build')
        expect(notifyInfo).not.toHaveBeenCalledWith('build is hidden', expect.anything())

        await act(async () => {
            await result.current.session.createFolder('C:\\ws', 'node_modules')
        })
        expect(result.current.session.tree.map((node) => node.name)).not.toContain('node_modules')
        expect(notifyInfo).toHaveBeenCalledWith('node_modules is hidden', {
            description: 'Scrivon leaves tool and build folders like this one out of the file list.',
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

    it('renames a file Scrivon does not open to any name, such as fixing its letter case', async () => {
        await disk.write('C:\\ws\\logo.PNG', 'PNG BYTES')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWithDraftTab(result)

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\logo.PNG', 'logo.png', false)
        })
        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\logo.png', 'logo-dark.png', false)
        })

        expect(await disk.read('C:\\ws\\logo-dark.png')).toBe('PNG BYTES')
        expect(notifyError).not.toHaveBeenCalled()
    })
})

describe('recent files', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        mountDisk(createWindowsDisk({ 'C:\\ws\\notes.md': 'NOTES', 'C:\\ws\\docs\\a.md': 'A' }))
    })

    async function open(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
    }

    it('follow a renamed file or folder, and leave a deleted one', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\notes.md', 'ideas.md', false)
        })
        expect(renameRecentFiles).toHaveBeenCalledWith('C:\\ws', 'C:\\ws\\notes.md', 'C:\\ws\\ideas.md')

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\docs', true)
        })
        expect(removeRecentFiles).toHaveBeenCalledWith('C:\\ws', 'C:\\ws\\docs')
    })

    it('stay as they were when the rename or delete fails', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        vi.mocked(rename).mockRejectedValueOnce('Access is denied. (os error 5)')
        vi.mocked(remove).mockRejectedValueOnce('Access is denied. (os error 5)')

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\notes.md', 'ideas.md', false)
        })
        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\notes.md', false)
        })

        expect(renameRecentFiles).not.toHaveBeenCalled()
        expect(removeRecentFiles).not.toHaveBeenCalled()
    })

    it('never make a rename or delete fail when they cannot be updated', async () => {
        vi.mocked(renameRecentFiles).mockRejectedValueOnce('There is not enough space on the disk. (os error 112)')
        vi.mocked(removeRecentFiles).mockRejectedValueOnce('There is not enough space on the disk. (os error 112)')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)

        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\notes.md', 'ideas.md', false)
        })
        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\ideas.md', false)
        })

        expect(notifyError).not.toHaveBeenCalled()
        await waitFor(() => expect(warn).toHaveBeenCalledWith("Couldn't update recent files", expect.anything()))
        warn.mockRestore()
    })
})

describe('reading only the folder an action changed', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 60_000 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\sub\\a.mmd': 'graph TD', 'C:\\ws\\other\\deep\\b.md': '# B', 'C:\\ws\\top.md': '# Top' })
        mountDisk(disk)
    })

    /** The folders listed while `action` ran. */
    async function foldersReadDuring(result: { current: ReturnType<typeof useHarness> }, action: () => Promise<void>) {
        vi.mocked(readDir).mockClear()
        await act(action)
        return vi.mocked(readDir).mock.calls.map(([path]) => String(path))
    }

    async function open(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
    }

    const namesIn = (result: { current: ReturnType<typeof useHarness> }, folder: string) =>
        (result.current.session.tree.find((n) => n.name === folder) as Extract<FileNode, { kind: 'directory' }>).children.map((n) => n.name)

    it('creates, duplicates, renames and deletes in a folder without reading the rest again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        const other = result.current.session.tree.find((n) => n.name === 'other')

        expect(await foldersReadDuring(result, () => result.current.session.createFile('C:\\ws\\sub', 'new.md', '# New'))).toEqual(['C:\\ws\\sub'])
        expect(namesIn(result, 'sub')).toEqual(['a.mmd', 'new.md'])

        expect(await foldersReadDuring(result, () => result.current.session.createFolder('C:\\ws\\sub', 'drafts'))).toEqual([
            'C:\\ws\\sub',
            'C:\\ws\\sub\\drafts',
        ])
        expect(await foldersReadDuring(result, () => result.current.session.duplicateFile('C:\\ws\\sub\\a.mmd'))).toEqual([
            'C:\\ws\\sub',
            'C:\\ws\\sub',
            'C:\\ws\\sub\\drafts',
        ])
        expect(await foldersReadDuring(result, () => result.current.session.renameEntry('C:\\ws\\sub\\new.md', 'renamed.md', false))).toEqual([
            'C:\\ws\\sub',
            'C:\\ws\\sub\\drafts',
        ])
        expect(await foldersReadDuring(result, () => result.current.session.deleteEntry('C:\\ws\\sub\\a copy.mmd', false))).toEqual([
            'C:\\ws\\sub',
            'C:\\ws\\sub\\drafts',
        ])

        expect(namesIn(result, 'sub')).toEqual(['drafts', 'a.mmd', 'renamed.md'])
        // The folders around it are the same objects, so their rows don't draw again.
        expect(result.current.session.tree.find((n) => n.name === 'other')).toBe(other)
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('reads the whole tree for a change at the top of the folder, or in a folder it never read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)

        expect(await foldersReadDuring(result, () => result.current.session.deleteEntry('C:\\ws\\top.md', false))).toContain('C:\\ws\\other\\deep')
        expect(result.current.session.tree.map((n) => n.name)).toEqual(['other', 'sub'])
    })

    /** Makes the next listing of `folder` wait until the test lets it finish; later ones don't wait. */
    function holdNextListing(folder: string) {
        let finish!: () => void
        const done = new Promise<void>((resolve) => (finish = resolve))
        let held = false
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (!held && String(dir) === folder) {
                held = true
                await done
            }
            return disk.list(String(dir))
        }) as unknown as typeof readDir)
        return finish
    }

    it('still shows what a read of the whole tree it stopped would have shown', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        // A git pull adds a file elsewhere, and coming back to the window starts reading the folder again.
        await disk.write('C:\\ws\\other\\pulled.md', '# Pulled')
        const finish = holdNextListing('C:\\ws')
        act(() => windowFocus.handler!({ payload: true }))

        // The user creates a file before that read is done.
        await act(() => result.current.session.createFile('C:\\ws\\sub', 'new.md', '# New'))
        await act(async () => finish())

        expect(namesIn(result, 'sub')).toEqual(['a.mmd', 'new.md'])
        expect(namesIn(result, 'other')).toEqual(['deep', 'pulled.md'])
    })

    it('reads again the folder of an earlier action whose read it stopped', async () => {
        await disk.write('C:\\ws\\sub\\keep.md', '# Keep')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        const finish = holdNextListing('C:\\ws\\sub')

        // A delete in one folder, then a new file in another before the first folder is read again.
        let deleting!: Promise<void>
        act(() => {
            deleting = result.current.session.deleteEntry('C:\\ws\\sub\\a.mmd', false)
        })
        await waitFor(() => expect(readDir).toHaveBeenCalledWith('C:\\ws\\sub'))
        await act(() => result.current.session.createFile('C:\\ws\\other', 'new.md', '# New'))
        await act(async () => {
            finish()
            await deleting
        })

        expect(namesIn(result, 'sub')).toEqual(['keep.md'])
        expect(namesIn(result, 'other')).toEqual(['deep', 'new.md'])
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('reads the whole tree when reading just the folder fails', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        vi.mocked(readDir).mockRejectedValueOnce('The network path was not found. (os error 53)')

        const read = await foldersReadDuring(result, () => result.current.session.createFile('C:\\ws\\sub', 'new.md', '# New'))

        expect(read).toContain('C:\\ws')
        expect(namesIn(result, 'sub')).toEqual(['a.mmd', 'new.md'])
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

    it('names the folders the file list hides before deleting a folder that has them', async () => {
        await disk.write('C:\\ws\\sub\\.git\\HEAD', 'ref: refs/heads/main')
        await disk.write('C:\\ws\\sub\\site\\node_modules\\x\\index.js', '')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\sub', true)
        })
        expect(confirmDeleteHiddenFolders).toHaveBeenCalledWith('sub', expect.arrayContaining(['.git', 'site\\node_modules']))
        // Cancelled: nothing is deleted.
        expect(remove).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\sub\\.git\\HEAD')).toBe('ref: refs/heads/main')

        vi.mocked(confirmDeleteHiddenFolders).mockResolvedValueOnce(true)
        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\sub', true)
        })
        expect(await disk.exists('C:\\ws\\sub')).toBe(false)
    })

    it("doesn't ask again before deleting a folder with nothing hidden in it", async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\sub', true)
        })

        expect(confirmDeleteHiddenFolders).not.toHaveBeenCalled()
        expect(await disk.exists('C:\\ws\\sub')).toBe(false)
    })

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

    it('says so when a folder could not be removed from the recent list, instead of failing silently', async () => {
        vi.mocked(getRecentWorkspaces).mockResolvedValueOnce(['D:\\old'])
        vi.mocked(removeRecentWorkspace).mockRejectedValueOnce('no app data folder')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.hydrated).toBe(true))

        await act(async () => {
            await result.current.session.removeRecent('D:\\old')
        })

        expect(notifyError).toHaveBeenCalledWith("Couldn't update recent folders", 'no app data folder')
        expect(result.current.session.recentWorkspaces).toEqual(['D:\\old'])
    })

    it('stops a folder removed from Recent opening without the dialog, unless it is open or has changes kept from a crash', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const crashed: UnsavedBackup = { path: 'E:\\crashed\\notes.md', root: 'E:\\crashed', content: 'kept', stamp: null, savedAt: 1 }
        vi.mocked(listUnsavedBackups).mockResolvedValue([crashed])
        try {
            const { result } = renderHook(useHarness, { wrapper: createWrapper() })
            await waitFor(() => expect(result.current.session.hydrated).toBe(true))
            await openWorkspace(result)

            for (const path of ['D:\\private', 'c:/WS', 'E:\\crashed']) {
                await act(async () => {
                    await result.current.session.removeRecent(path)
                })
            }

            expect(removeRecentWorkspace).toHaveBeenCalledTimes(3)
            const forgotten = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'forget_workspace')
            expect(forgotten).toEqual([['forget_workspace', { path: 'D:\\private' }]])
        } finally {
            vi.mocked(listUnsavedBackups).mockResolvedValue([])
        }
    })

    it('keeps a folder openable when it could not be removed from the recent list', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(removeRecentWorkspace).mockRejectedValueOnce('no app data folder')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.hydrated).toBe(true))

        await act(async () => {
            await result.current.session.removeRecent('D:\\old')
        })

        expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'forget_workspace')).toBe(false)
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

    it('shows a linked folder that leads outside the opened one, and says why it is empty', async () => {
        const list = disk.list
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (dir === 'C:\\ws') return [...(await list(dir)), { name: 'shared', isDirectory: false, isFile: false, isSymlink: true }]
            return list(dir)
        }) as unknown as typeof readDir)
        const diskStat = disk.stat
        vi.mocked(stat).mockImplementation((async (path: string) => {
            if (path === 'C:\\ws\\shared') throw 'forbidden path: C:\\ws\\shared'
            return diskStat(path)
        }) as unknown as typeof stat)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await openWorkspace(result)

        expect(result.current.session.tree.find((node) => node.name === 'shared')).toEqual({
            kind: 'directory',
            name: 'shared',
            path: 'C:\\ws\\shared',
            children: [],
            unreadable: true,
            linksOutside: true,
        })
        expect(notifyWarning).toHaveBeenCalledWith("Couldn't open the linked folder shared", {
            description: "It shows as empty. It links to a folder outside the one you opened, which Scrivon can't open yet.",
        })
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

    it('copies a file Scrivon does not open without trying to open the copy', async () => {
        await disk.write('C:\\ws\\logo.png', 'PNG BYTES')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        await act(async () => {
            await result.current.session.duplicateFile('C:\\ws\\logo.png')
        })

        expect(await disk.read('C:\\ws\\logo copy.png')).toBe('PNG BYTES')
        expect(showError).not.toHaveBeenCalled()
        expect(notifyError).not.toHaveBeenCalled()
        expect(result.current.tabs.tabs).toEqual([])
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
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValue('keep')
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
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce('overwrite')
        await expect(save()).resolves.toBe(true)
        expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS')
        expect(result.current.tabs.tabs[0]).toMatchObject({ isDirty: false, saveError: undefined })

        // The overwrite is now the version the tab knows, so the next save doesn't ask.
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS 2'))
        await expect(save()).resolves.toBe(true)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledTimes(2)
    })

    it('never asks from an autosave, as a question popping up while the user types could take a key as its answer', async () => {
        settingsState.autosave = { enabled: true, delayMs: 20 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'MY EDITS', isDirty: false }))
        await disk.write('C:\\ws\\notes.md', 'edited in VS Code')

        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS 2'))

        await waitFor(() => expect(result.current.tabs.tabs[0]?.saveError).toBe('It was changed outside Scrivon since you opened it.'))
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\notes.md')).toBe('edited in VS Code')
        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'MY EDITS 2', isDirty: true, isSaving: false })
        const notice = vi.mocked(notifyError).mock.calls.find(([title]) => title === "Couldn't save notes.md")
        expect(notice?.[2]).toMatchObject({ timeout: 0, action: { label: 'Try Again' } })

        // More typing doesn't try again, so nothing is asked later either.
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS 3'))
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 60))
        })
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledTimes(1)

        // Try Again on the notice is the user asking, so it asks.
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce('overwrite')
        await act(async () => {
            ;(notice![2] as NotifyOptions).action!.onClick()
        })
        await waitFor(async () => expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS 3'))
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'changed')
    })

    it('never asks when the user switches away from a tab whose file changed elsewhere', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await disk.write('C:\\ws\\notes.md', 'edited in VS Code')

        act(() => coordinatorOut.current!.flushSaveOnTabLeave.current('C:\\ws\\notes.md'))

        await waitFor(() => expect(result.current.tabs.tabs[0]?.saveError).toBe('It was changed outside Scrivon since you opened it.'))
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
        expect(await disk.read('C:\\ws\\notes.md')).toBe('edited in VS Code')
        // Saving it on purpose asks.
        await expect(save()).resolves.toBe(false)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'changed')
    })

    it('shows the other version and drops the edits when the user picks Reload', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await disk.write('C:\\ws\\notes.md', 'edited in VS Code')
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce('reload')

        // A close waiting on this save can go ahead: nothing is left to save.
        await expect(save()).resolves.toBe(true)

        expect(await disk.read('C:\\ws\\notes.md')).toBe('edited in VS Code')
        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'edited in VS Code', isDirty: false, isSaving: false })
        expect(result.current.tabs.tabs[0]?.saveError).toBeUndefined()
        expect(deleteUnsavedBackup).toHaveBeenCalledWith('C:\\ws\\notes.md')
        expect(notifyError).not.toHaveBeenCalled()

        // The reloaded file is the version the tab knows now, so the next save doesn't ask.
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'MY EDITS ON TOP'))
        await expect(save()).resolves.toBe(true)
        expect(await disk.read('C:\\ws\\notes.md')).toBe('MY EDITS ON TOP')
        expect(confirmOverwriteDiskChange).toHaveBeenCalledTimes(1)
    })

    it('keeps the edits when Reload is picked but the file can no longer be read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        await disk.write('C:\\ws\\notes.md', 'edited in VS Code')
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce('reload')
        vi.mocked(readFile).mockRejectedValueOnce('The process cannot access the file because it is being used by another process. (os error 32)')

        await expect(save()).resolves.toBe(false)

        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'MY EDITS', isDirty: true })
        expect(notifyError).toHaveBeenCalledWith(
            "Couldn't save notes.md",
            expect.anything(),
            expect.objectContaining({ description: expect.stringContaining("Couldn't reload it.") })
        )
        expect(deleteUnsavedBackup).not.toHaveBeenCalled()
        // Typing doesn't ask again after every pause.
        act(() => coordinatorOut.current!.flushSaveOnTabLeave.current('C:\\ws\\notes.md'))
        expect(confirmOverwriteDiskChange).toHaveBeenCalledTimes(1)
    })

    it('shows the new text of an open file without edits that another app changed, when the window gets focus', async () => {
        await disk.write('C:\\ws\\other.md', 'other v1')
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\other.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\other.md', 'MY EDITS'))
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        await disk.write('C:\\ws\\notes.md', 'pulled by git')
        await disk.write('C:\\ws\\other.md', 'other v2 from git')

        await act(async () => {
            windowFocus.handler!({ payload: true })
        })

        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'pulled by git', isDirty: false }))
        // The tab with edits keeps them; saving it asks about the change.
        expect(result.current.tabs.tabs[1]).toMatchObject({ content: 'MY EDITS', isDirty: true })
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
        // The new text is the version the tab knows now, so editing and saving it doesn't ask.
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'pulled by git, then edited'))
        await expect(save()).resolves.toBe(true)
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
    })

    describe('while the window stays focused', () => {
        let report: ((event: WatchEvent) => void) | undefined
        const unwatch = vi.fn()

        beforeEach(() => {
            report = undefined
            vi.mocked(watchImmediate).mockImplementation(async (_path, cb) => {
                report = cb
                return unwatch
            })
        })

        afterEach(() => {
            vi.mocked(watchImmediate).mockReset()
        })

        async function openWatched(result: { current: ReturnType<typeof useHarness> }) {
            await act(async () => {
                await result.current.session.openWorkspace('C:\\ws')
            })
            await waitFor(() => expect(report).toBeDefined())
        }

        it('shows files another app adds, and stops watching when the folder closes', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openWatched(result)
            expect(watchImmediate).toHaveBeenCalledWith('C:\\ws', expect.any(Function), { recursive: true })

            await disk.write('C:\\ws\\from-sync.md', '# new')
            await act(async () => {
                report!({ type: { create: { kind: 'any' } }, paths: ['C:\\ws\\from-sync.md'], attrs: null })
            })
            await waitFor(() => expect(result.current.session.tree.map((n) => n.name)).toEqual(['from-sync.md', 'notes.md']))

            await act(async () => {
                await result.current.session.closeWorkspace()
            })
            expect(unwatch).toHaveBeenCalled()
        })

        it('shows the new text of an open file another app saved, without reading the folder again, and ignores .git', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openWatched(result)
            await act(async () => {
                await result.current.tabs.openFile('C:\\ws\\notes.md')
            })
            const readsBefore = vi.mocked(readDir).mock.calls.length

            await act(async () => {
                report!({ type: { modify: { kind: 'any' } }, paths: ['C:\\ws\\.git\\index'], attrs: null })
            })
            await disk.write('C:\\ws\\notes.md', 'saved by another editor')
            // Saved the way Scrivon saves: a temporary file renamed over it.
            await act(async () => {
                report!({
                    type: { modify: { kind: 'rename', mode: 'both' } },
                    paths: ['C:\\ws\\.scrivon-save-x1.tmp', 'C:\\ws\\notes.md'],
                    attrs: null,
                })
            })

            await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'saved by another editor', isDirty: false }))
            expect(readDir).toHaveBeenCalledTimes(readsBefore)
        })

        it('takes a save on Windows, reported as the file renamed away and back, as a change, not a new file list', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openWatched(result)
            await act(async () => {
                await result.current.tabs.openFile('C:\\ws\\notes.md')
            })
            const readsBefore = vi.mocked(readDir).mock.calls.length
            await disk.write('C:\\ws\\notes.md', 'saved by another editor')

            const rename = (mode: 'from' | 'to', path: string) => report!({ type: { modify: { kind: 'rename', mode } }, paths: [path], attrs: null })
            await act(async () => {
                report!({ type: { create: { kind: 'any' } }, paths: ['C:\\ws\\notes.md~RF1f2e.TMP'], attrs: null })
                rename('from', 'C:\\ws\\notes.md')
                rename('to', 'C:\\ws\\notes.md~RF1f2e.TMP')
                rename('from', 'C:\\ws\\.scrivon-save-x1.tmp')
                rename('to', 'C:\\ws\\notes.md')
                report!({ type: { modify: { kind: 'any' } }, paths: ['C:\\ws\\notes.md'], attrs: null })
                report!({ type: { remove: { kind: 'any' } }, paths: ['C:\\ws\\notes.md~RF1f2e.TMP'], attrs: null })
            })

            await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'saved by another editor', isDirty: false }))
            expect(readDir).toHaveBeenCalledTimes(readsBefore)
            expect(result.current.session.tree.map((n) => n.name)).toEqual(['notes.md'])
        })

        it('looks only at the open files a change names, or that are inside a folder it names', async () => {
            await disk.write('C:\\ws\\other.md', 'other v1')
            await disk.write('C:\\ws\\docs\\inside.md', 'inside v1')
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openWatched(result)
            for (const path of ['C:\\ws\\notes.md', 'C:\\ws\\other.md', 'C:\\ws\\docs\\inside.md']) {
                await act(async () => {
                    await result.current.tabs.openFile(path)
                })
            }
            const tabText = (id: string) => result.current.tabs.tabs.find((t) => t.id === id)?.content
            // Each look at an open file is a plugin-fs stat, which runs on the window's main thread.
            const lookedAt = (name: string) => vi.mocked(stat).mock.calls.some(([path]) => String(path).toLowerCase().endsWith(name))
            vi.mocked(stat).mockClear()

            // An autosave, or another app saving notes.md.
            await disk.write('C:\\ws\\notes.md', 'saved by another editor')
            await act(async () => {
                report!({ type: { modify: { kind: 'any' } }, paths: ['C:\\ws\\notes.md'], attrs: null })
            })
            await waitFor(() => expect(tabText('C:\\ws\\notes.md')).toBe('saved by another editor'))
            expect(lookedAt('other.md')).toBe(false)
            expect(lookedAt('inside.md')).toBe(false)

            // A folder put back (renamed back, say) is named on its own.
            vi.mocked(stat).mockClear()
            await disk.write('C:\\ws\\docs\\inside.md', 'inside v2')
            await act(async () => {
                report!({ type: { create: { kind: 'folder' } }, paths: ['C:\\ws\\docs'], attrs: null })
            })
            await waitFor(() => expect(tabText('C:\\ws\\docs\\inside.md')).toBe('inside v2'))
            expect(lookedAt('other.md')).toBe(false)
        })

        it('shows the new text of an open file straight away, even right after the folder was read', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openWatched(result)
            await act(async () => {
                await result.current.tabs.openFile('C:\\ws\\notes.md')
            })
            // Another app adds a file, so the folder is read again; the next read has to wait a few seconds.
            const readsBefore = vi.mocked(readDir).mock.calls.length
            await disk.write('C:\\ws\\from-sync.md', '# new')
            await act(async () => {
                report!({ type: { create: { kind: 'any' } }, paths: ['C:\\ws\\from-sync.md'], attrs: null })
            })
            await waitFor(() => expect(readDir).toHaveBeenCalledTimes(readsBefore + 1))

            await disk.write('C:\\ws\\notes.md', 'saved by another editor')
            await act(async () => {
                report!({ type: { modify: { kind: 'any' } }, paths: ['C:\\ws\\notes.md'], attrs: null })
            })

            await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'saved by another editor', isDirty: false }))
            expect(readDir).toHaveBeenCalledTimes(readsBefore + 1)
        })

        it('still reads the folder on focus where it cannot be watched', async () => {
            vi.mocked(watchImmediate).mockRejectedValue('Access is denied. (os error 5)')
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await act(async () => {
                await result.current.session.openWorkspace('C:\\ws')
            })
            await waitFor(() => expect(windowFocus.handler).toBeDefined())
            await disk.write('C:\\ws\\from-git.md', '# new')

            await act(async () => {
                windowFocus.handler!({ payload: true })
            })

            await waitFor(() => expect(result.current.session.tree.map((n) => n.name)).toEqual(['from-git.md', 'notes.md']))
            expect(notifyError).not.toHaveBeenCalled()
        })

        it("doesn't watch a folder too big to show it all, such as a drive, but still reads it on focus", async () => {
            const entry = (name: string, isDirectory: boolean) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false })
            vi.mocked(readDir).mockImplementation((async (dir: string) => {
                if (dir === 'D:\\') return [entry('big', true), entry('sub', true)]
                if (dir === 'D:\\big') return Array.from({ length: 50_001 }, (_, i) => entry(`f${i}.md`, false))
                if (dir === 'D:\\sub') return [entry('deeper', true)]
                return [entry('x.md', false)]
            }) as unknown as typeof readDir)
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await act(async () => {
                await result.current.session.openWorkspace('D:\\')
            })
            await waitFor(() => expect(windowFocus.handler).toBeDefined())
            expect(watchImmediate).not.toHaveBeenCalled()
            const reads = vi.mocked(readDir).mock.calls.length

            await act(async () => {
                windowFocus.handler!({ payload: true })
            })

            await waitFor(() => expect(vi.mocked(readDir).mock.calls.length).toBeGreaterThan(reads))
        })
    })

    it('leaves an open file without edits as it is when another app deleted it', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        await disk.write('C:\\ws\\kept.md', 'still here')
        await disk.remove('C:\\ws\\notes.md')

        await act(async () => {
            windowFocus.handler!({ payload: true })
        })

        await waitFor(() => expect(result.current.session.tree.map((n) => n.name)).toEqual(['kept.md']))
        expect(result.current.tabs.tabs).toEqual([expect.objectContaining({ id: 'C:\\ws\\notes.md', content: 'mine v1', isDirty: false })])
    })

    it('asks before bringing back a file deleted in another app', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndEdit(result)
        disk.contents.clear()

        await expect(save()).resolves.toBe(false)
        expect(confirmOverwriteDiskChange).toHaveBeenCalledWith('notes.md', 'deleted')
        expect(await disk.exists('C:\\ws\\notes.md')).toBe(false)

        vi.mocked(confirmOverwriteDiskChange).mockResolvedValueOnce('overwrite')
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

    it('reads the folder again at most every few seconds on focus, and redraws nothing when nothing changed', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        const shown = result.current.session.tree
        const readsAfterOpen = vi.mocked(readDir).mock.calls.length

        await act(async () => {
            windowFocus.handler!({ payload: true })
        })
        await waitFor(() => expect(readDir).toHaveBeenCalledTimes(readsAfterOpen + 1))
        expect(result.current.session.tree).toBe(shown)

        // Back again straight away (alt-tab, or a dialog closing): not read again yet.
        await act(async () => {
            windowFocus.handler!({ payload: true })
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
        expect(readDir).toHaveBeenCalledTimes(readsAfterOpen + 1)
    })

    it('shows the new text of an open file when the window gets focus again soon after, without reading the folder again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        const readsAfterOpen = vi.mocked(readDir).mock.calls.length
        await act(async () => {
            windowFocus.handler!({ payload: true })
        })
        await waitFor(() => expect(readDir).toHaveBeenCalledTimes(readsAfterOpen + 1))

        // Saved in VS Code, then back to Scrivon within a few seconds.
        await disk.write('C:\\ws\\notes.md', 'saved in VS Code')
        await act(async () => {
            windowFocus.handler!({ payload: true })
        })

        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'saved in VS Code', isDirty: false }))
        expect(readDir).toHaveBeenCalledTimes(readsAfterOpen + 1)
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
        vi.mocked(confirmOverwriteDiskChange).mockResolvedValue('keep')
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

    describe('when their folder is gone', () => {
        const gone = (path: string, content: string, overrides: Partial<UnsavedBackup> = {}) =>
            kept(path, content, { root: 'D:\\renamed', ...overrides })

        async function openGone(result: { current: ReturnType<typeof useHarness> }) {
            await act(async () => {
                await result.current.session.openWorkspace('D:\\renamed')
            })
            await waitFor(() => expect(confirmKeptChangesWithoutFolder).toHaveBeenCalled())
        }

        it('keeps them for later when the user says so, or just closes the question', async () => {
            vi.mocked(listUnsavedBackups).mockResolvedValue([gone('D:\\renamed\\a.md', 'mine')])
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })

            await openGone(result)

            expect(confirmKeptChangesWithoutFolder).toHaveBeenCalledWith('renamed', ['a.md'])
            expect(notifyError).toHaveBeenCalledWith("Couldn't open renamed", expect.anything(), expect.anything())
            expect(deleteUnsavedBackup).not.toHaveBeenCalled()
        })

        it('discards them when the user chooses to, so the notice stops coming back', async () => {
            vi.mocked(listUnsavedBackups).mockResolvedValue([gone('D:\\renamed\\a.md', 'mine'), kept('C:\\ws\\notes.md', 'other folder')])
            vi.mocked(confirmKeptChangesWithoutFolder).mockResolvedValueOnce('discard')
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })

            await openGone(result)

            await waitFor(() => expect(deleteUnsavedBackup).toHaveBeenCalledWith('D:\\renamed\\a.md'))
            expect(deleteUnsavedBackup).toHaveBeenCalledTimes(1)
            expect(dismissNotification).toHaveBeenCalledWith('recovered-changes')
        })

        it('saves them as new files in a folder the user picks, then lets the copies go', async () => {
            await disk.write('C:\\rescue\\a.md', 'already here')
            vi.mocked(listUnsavedBackups).mockResolvedValue([
                gone('D:\\renamed\\a.md', 'mine'),
                gone('D:\\renamed\\b.md', 'B', { format: { encoding: 'utf-16le', bom: true } }),
            ])
            vi.mocked(confirmKeptChangesWithoutFolder).mockResolvedValueOnce('save')
            vi.mocked(pickWorkspaceFolder).mockResolvedValueOnce('C:\\rescue')
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })

            await openGone(result)

            await waitFor(() => expect(deleteUnsavedBackup).toHaveBeenCalledTimes(2))
            expect(pickWorkspaceFolder).toHaveBeenCalledWith('Save Copies To')
            expect(await disk.read('C:\\rescue\\a.md')).toBe('already here')
            expect(await disk.read('C:\\rescue\\a 2.md')).toBe('mine')
            // Stored the way the file was: UTF-16 with a byte-order mark.
            expect(vi.mocked(writeFile)).toHaveBeenCalledWith('C:\\rescue\\b.md', new Uint8Array([0xff, 0xfe, 0x42, 0x00]), { createNew: true })
            expect(notifySuccess).toHaveBeenCalledWith('Saved 2 files', { description: "They're in rescue." })
        })

        it('keeps them when saving the copies fails', async () => {
            vi.mocked(listUnsavedBackups).mockResolvedValue([gone('D:\\renamed\\a.md', 'mine')])
            vi.mocked(confirmKeptChangesWithoutFolder).mockResolvedValueOnce('save')
            vi.mocked(pickWorkspaceFolder).mockResolvedValueOnce('E:\\unplugged')
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })

            await openGone(result)

            await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't save the copies", expect.anything()))
            expect(deleteUnsavedBackup).not.toHaveBeenCalled()
        })
    })

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

    describe('when the user opens that file while the tabs are still loading', () => {
        let finishOther!: () => void

        beforeEach(() => {
            vi.mocked(getWorkspaceTabSession).mockResolvedValueOnce({ tabIds: ['C:\\ws\\other.md'], activeTabId: 'C:\\ws\\other.md' })
            vi.mocked(listUnsavedBackups).mockResolvedValue([kept('C:\\ws\\notes.md', 'typed before the crash')])
            // Reading the other saved tab is slow, so the user has time to open notes.md from the tree first.
            const otherRead = new Promise<void>((resolve) => (finishOther = resolve))
            vi.mocked(readFile).mockImplementation(async (path) => {
                if (String(path).endsWith('other.md')) await otherRead
                return disk.readBytes(path)
            })
        })

        async function openNotesDuringRestore(result: { current: ReturnType<typeof useHarness> }, typed?: string, { saved = false } = {}) {
            let opening!: Promise<void>
            act(() => {
                opening = result.current.session.openWorkspace('C:\\ws')
            })
            await waitFor(() => expect(result.current.session.workspaceRoot).toBe('C:\\ws'))
            await act(async () => {
                await result.current.tabs.openFile('C:\\ws\\notes.md')
            })
            expect(result.current.tabs.tabs).toEqual([expect.objectContaining({ id: 'C:\\ws\\notes.md', content: 'on disk', isDirty: false })])
            if (typed !== undefined) act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', typed))
            if (saved) await expect(save('C:\\ws\\notes.md')).resolves.toBe(true)
            await act(async () => {
                finishOther()
                await opening
            })
        }

        it('puts the unsaved text into the tab the user opened', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openNotesDuringRestore(result)

            expect(result.current.tabs.tabs).toEqual([
                expect.objectContaining({ id: 'C:\\ws\\other.md' }),
                expect.objectContaining({ id: 'C:\\ws\\notes.md', content: 'typed before the crash', isDirty: true }),
            ])
            expect(result.current.tabs.activeTabId).toBe('C:\\ws\\notes.md')
            expect(notifyWarning).toHaveBeenCalledWith(
                'Recovered unsaved changes',
                expect.objectContaining({ id: 'recovered-changes', description: expect.stringContaining('your changes to notes.md') })
            )
            await expect(save('C:\\ws\\notes.md')).resolves.toBe(true)
            expect(await disk.read('C:\\ws\\notes.md')).toBe('typed before the crash')
        })

        it('saves the unsaved text as a new file when the user already typed in that tab, and keeps what they typed', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openNotesDuringRestore(result, 'typed after opening')

            expect(result.current.tabs.tabs.find((t) => t.id === 'C:\\ws\\notes.md')).toMatchObject({ content: 'typed after opening', isDirty: true })
            await waitFor(async () => expect(await disk.exists('C:\\ws\\notes (recovered).md')).toBe(true))
            expect(await disk.read('C:\\ws\\notes (recovered).md')).toBe('typed before the crash')
            expect(notifyWarning).not.toHaveBeenCalledWith('Recovered unsaved changes', expect.objectContaining({ id: 'recovered-changes' }))
            await waitFor(() =>
                expect(notifyWarning).toHaveBeenCalledWith(
                    'Recovered unsaved changes',
                    expect.objectContaining({ description: expect.stringContaining("they're saved as notes (recovered).md instead") })
                )
            )
            await waitFor(() => expect(result.current.session.tree.map((n) => n.name)).toContain('notes (recovered).md'))
            expect(deleteUnsavedBackup).not.toHaveBeenCalled()
        })

        it('saves the unsaved text as a new file when the user typed in that tab and saved it, and keeps what they saved', async () => {
            const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
            await openNotesDuringRestore(result, 'typed and saved after opening', { saved: true })

            // Clean again, but newer than the text kept from the crash, which doesn't replace it.
            expect(result.current.tabs.tabs.find((t) => t.id === 'C:\\ws\\notes.md')).toMatchObject({
                content: 'typed and saved after opening',
                isDirty: false,
            })
            await waitFor(async () => expect(await disk.exists('C:\\ws\\notes (recovered).md')).toBe(true))
            expect(await disk.read('C:\\ws\\notes (recovered).md')).toBe('typed before the crash')
            expect(await disk.read('C:\\ws\\notes.md')).toBe('typed and saved after opening')
            expect(notifyWarning).not.toHaveBeenCalledWith('Recovered unsaved changes', expect.objectContaining({ id: 'recovered-changes' }))
        })
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

    it('stops reading the earlier folder once another one is picked', async () => {
        await disk.write('C:\\big\\sub\\deep.md', 'D')
        const finishBig = slowFolder('C:\\big')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        let openingBig!: Promise<void>
        act(() => {
            openingBig = result.current.session.openWorkspace('C:\\big')
        })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\small')
        })
        await act(async () => {
            finishBig()
            await openingBig
        })

        // C:\big itself had been asked for already; nothing inside it is read after the switch.
        expect(readDir).not.toHaveBeenCalledWith('C:\\big\\sub')
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['b.md'])
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('says, until closed, when a folder has too many files to show them all', async () => {
        const entry = (name: string, isDirectory: boolean) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false })
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (dir === 'D:\\') return [entry('big', true), entry('sub', true)]
            if (dir === 'D:\\big') return Array.from({ length: 50_001 }, (_, i) => entry(`f${i}.md`, false))
            if (dir === 'D:\\sub') return [entry('deeper', true)]
            return [entry('x.md', false)]
        }) as unknown as typeof readDir)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('D:\\')
        })

        expect(readDir).not.toHaveBeenCalledWith('D:\\sub\\deeper')
        expect(result.current.session.tree[1]).toMatchObject({ name: 'sub', children: [{ name: 'deeper', children: [], truncated: true }] })
        expect(notifyWarning).toHaveBeenCalledWith(
            'D:\\ has too many files to show them all',
            expect.objectContaining({ id: 'folder-too-big', timeout: 0, description: expect.stringContaining('50,000') })
        )

        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        expect(dismissNotification).toHaveBeenCalledWith('folder-too-big')
    })

    it('says when the open folder grows too big to show it all, takes that back once it shrinks, and says it again when reopened', async () => {
        const entry = (name: string, isDirectory: boolean) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false })
        let files = 3
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (dir === 'D:\\') return [entry('big', true), entry('sub', true)]
            if (dir === 'D:\\big') return Array.from({ length: files }, (_, i) => entry(`f${i}.md`, false))
            if (dir === 'D:\\sub') return [entry('deeper', true)]
            return [entry('x.md', false)]
        }) as unknown as typeof readDir)
        const tooBigNotices = () => vi.mocked(notifyWarning).mock.calls.filter(([, options]) => options?.id === 'folder-too-big').length
        const takenBack = () => vi.mocked(dismissNotification).mock.calls.filter(([id]) => id === 'folder-too-big').length
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('D:\\')
        })
        await waitFor(() => expect(windowFocus.handler).toBeDefined())
        expect(tooBigNotices()).toBe(0)

        // Another app filled a folder while Scrivon was in the background.
        files = 50_001
        await act(async () => {
            windowFocus.handler!({ payload: true })
        })
        await waitFor(() => expect(tooBigNotices()).toBe(1))
        expect(result.current.session.tree[1]).toMatchObject({ children: [{ name: 'deeper', truncated: true }] })

        // Read again, still too big: a notice the user closed doesn't keep coming back.
        await act(async () => {
            await result.current.session.refreshTree()
        })
        expect(tooBigNotices()).toBe(1)

        // Opening it again says it again, as the first open does.
        await act(async () => {
            await result.current.session.openWorkspace('D:\\')
        })
        expect(tooBigNotices()).toBe(2)

        files = 3
        const before = takenBack()
        await act(async () => {
            await result.current.session.refreshTree()
        })
        expect(takenBack()).toBe(before + 1)
        expect(result.current.session.tree[1]).toMatchObject({ children: [{ name: 'deeper', children: [{ name: 'x.md' }] }] })
    })

    it('opens the folder clicked last when it is picked while a slow save holds up leaving the open one', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'edited'))
        let finishSave!: () => void
        const saveGate = new Promise<void>((resolve) => (finishSave = resolve))
        vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
            await saveGate
            return disk.writeBytes(path, data as Uint8Array, options)
        })

        let openingBig!: Promise<void>
        let openingSmall!: Promise<void>
        act(() => {
            openingBig = result.current.session.openWorkspace('C:\\big')
        })
        // Leaving C:\ws waits for notes.md to save; meanwhile the user picks another folder.
        await waitFor(() => expect(writeFile).toHaveBeenCalled())
        act(() => {
            openingSmall = result.current.session.openWorkspace('C:\\small')
        })
        await act(async () => {
            finishSave()
            await Promise.all([openingBig, openingSmall])
        })

        expect(result.current.session.workspaceRoot).toBe('C:\\small')
        expect(await disk.read('C:\\ws\\notes.md')).toBe('edited')
        expect(writeFile).toHaveBeenCalledTimes(1)
    })

    it('keeps the open folder when it is picked again while another one is still being read', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        const finishBig = slowFolder('C:\\big')

        let openingBig!: Promise<void>
        act(() => {
            openingBig = result.current.session.openWorkspace('C:\\big')
        })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            finishBig()
            await openingBig
        })

        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['notes.md', 'other.md'])
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

    /** Makes `mock` (a disk write or delete) wait until the test lets it finish. */
    function slowly<T extends (...args: never[]) => Promise<void>>(mock: T, run: T) {
        let finish!: () => void
        const done = new Promise<void>((resolve) => (finish = resolve))
        vi.mocked(mock).mockImplementation((async (...args: Parameters<T>) => {
            await done
            await run(...args)
        }) as unknown as T)
        return finish
    }

    /**
     * Opens C:\ws, starts `action` there, and once `started` passes (its disk change is under way) opens C:\small,
     * and then lets `finish` end the disk change.
     */
    async function switchFoldersDuring(
        started: () => void,
        finish: () => void,
        action: (session: ReturnType<typeof useWorkspaceSession>) => Promise<void>
    ) {
        const rendered = renderHook(useHarness, { wrapper: createWrapper() })
        const { result } = rendered
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        let acting!: Promise<void>
        act(() => {
            acting = action(result.current.session)
        })
        await waitFor(started)
        await act(async () => {
            await result.current.session.openWorkspace('C:\\small')
        })
        vi.mocked(readDir).mockClear()
        await act(async () => {
            finish()
            await acting
        })
        return rendered
    }

    const readsOfOldFolder = () => vi.mocked(readDir).mock.calls.filter(([dir]) => String(dir).toLowerCase().startsWith('c:\\ws'))

    it("keeps the new folder's file list when a delete in the folder open before ends after the switch", async () => {
        await disk.write('C:\\ws\\docs\\x.md', 'X')
        const finish = slowly(remove, disk.remove)

        const { result } = await switchFoldersDuring(
            () => expect(remove).toHaveBeenCalled(),
            finish,
            (session) => session.deleteEntry('C:\\ws\\docs', true)
        )

        expect(await disk.exists('C:\\ws\\docs')).toBe(false)
        expect(result.current.session.workspaceRoot).toBe('C:\\small')
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['b.md'])
        expect(readsOfOldFolder()).toEqual([])
        // Its recent files are those of the folder it was deleted from.
        expect(removeRecentFiles).toHaveBeenCalledWith('C:\\ws', 'C:\\ws\\docs')
        expect(removeRecentFiles).not.toHaveBeenCalledWith('C:\\small', expect.anything())
    })

    it('neither opens nor lists a copy made in the folder open before when it ends after the switch', async () => {
        const finish = slowly(writeFile, disk.writeBytes)

        const { result } = await switchFoldersDuring(
            () => expect(writeFile).toHaveBeenCalled(),
            finish,
            (session) => session.duplicateFile('C:\\ws\\notes.md')
        )

        expect(await disk.read('C:\\ws\\notes copy.md')).toBe('mine')
        expect(result.current.tabs.tabs).toEqual([])
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['b.md'])
        expect(readsOfOldFolder()).toEqual([])
    })

    it('neither opens nor lists a file created in the folder open before when it ends after the switch', async () => {
        const finish = slowly(writeTextFile, disk.write)

        const { result } = await switchFoldersDuring(
            () => expect(writeTextFile).toHaveBeenCalled(),
            finish,
            (session) => session.createFile('C:\\ws', 'new.md')
        )

        expect(await disk.exists('C:\\ws\\new.md')).toBe(true)
        expect(result.current.tabs.tabs).toEqual([])
        expect(result.current.session.tree.map((node) => node.name)).toEqual(['b.md'])
        expect(readsOfOldFolder()).toEqual([])
    })

    it('asks before reading a very large file again when reopening the tabs, and leaves it closed on Cancel', async () => {
        await disk.write('C:\\ws\\huge.log.md', 'big')
        vi.mocked(getWorkspaceTabSession).mockResolvedValue({
            tabIds: ['C:\\ws\\huge.log.md', 'C:\\ws\\notes.md'],
            activeTabId: 'C:\\ws\\huge.log.md',
        })
        vi.mocked(stat).mockImplementation((async (path: string) => {
            const info = await disk.stat(path)
            return String(path).endsWith('huge.log.md') ? { ...info, size: 80 * 1024 * 1024 } : info
        }) as unknown as typeof stat)
        vi.mocked(confirmOpenLargeFile).mockResolvedValueOnce(false)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })

        expect(confirmOpenLargeFile).toHaveBeenCalledWith('huge.log.md', '80 MB')
        expect(readFile).not.toHaveBeenCalledWith('C:\\ws\\huge.log.md')
        expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\notes.md'])
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

describe('saves around rename and delete', () => {
    let disk: ReturnType<typeof createWindowsDisk>
    const coordinatorOut: { current?: WorkspaceCoordinatorRefs } = {}

    beforeEach(() => {
        vi.clearAllMocks()
        // A short delay, so the autosave comes due while the rename or delete is still going on.
        settingsState.autosave = { enabled: true, delayMs: 50 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\notes.md': 'v1' })
        mountDisk(disk)
    })

    const pause = (ms: number) =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, ms))
        })

    /** From now on, reading the file list waits until the test lets it finish (a big folder). */
    function slowListing() {
        let finish!: () => void
        const done = new Promise<void>((resolve) => (finish = resolve))
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            await done
            return disk.list(String(dir))
        }) as unknown as typeof readDir)
        return finish
    }

    async function openAndType(result: { current: ReturnType<typeof useHarness> }) {
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'edited'))
    }

    it('never brings back a deleted file when its autosave comes due during the delete', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndType(result)
        const finishListing = slowListing()

        let deleting!: Promise<void>
        act(() => {
            deleting = result.current.session.deleteEntry('C:\\ws\\notes.md', false)
        })
        await pause(150)
        await act(async () => {
            finishListing()
            await deleting
        })
        await pause(100)

        expect(await disk.exists('C:\\ws\\notes.md')).toBe(false)
        expect(result.current.tabs.tabs).toEqual([])
        // Not even a question about putting it back.
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
    })

    it('saves a pending autosave under the new name and never writes the old one again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndType(result)
        const finishListing = slowListing()

        let renaming!: Promise<void>
        act(() => {
            renaming = result.current.session.renameEntry('C:\\ws\\notes.md', 'renamed.md', false)
        })
        await pause(150)
        await act(async () => {
            finishListing()
            await renaming
        })

        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ id: 'C:\\ws\\renamed.md', isDirty: false, isSaving: false }))
        expect(await disk.read('C:\\ws\\renamed.md')).toBe('edited')
        expect(await disk.exists('C:\\ws\\notes.md')).toBe(false)
        expect(confirmOverwriteDiskChange).not.toHaveBeenCalled()
    })

    it('lets a save that is already writing finish before the file is renamed', async () => {
        settingsState.autosave = { enabled: true, delayMs: 60_000 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper(coordinatorOut) })
        await openAndType(result)
        let finishWrite!: () => void
        const written = new Promise<void>((resolve) => (finishWrite = resolve))
        vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
            await written
            return disk.writeBytes(path, data as Uint8Array, options)
        })

        let saving!: Promise<boolean>
        let renaming!: Promise<void>
        act(() => {
            saving = coordinatorOut.current!.flushSave.current('C:\\ws\\notes.md')
            renaming = result.current.session.renameEntry('C:\\ws\\notes.md', 'renamed.md', false)
        })
        await pause(20)
        expect(await disk.exists('C:\\ws\\renamed.md')).toBe(false)

        await act(async () => {
            finishWrite()
            await Promise.all([saving, renaming])
        })

        expect(await disk.read('C:\\ws\\renamed.md')).toBe('edited')
        expect(await disk.exists('C:\\ws\\notes.md')).toBe(false)
        expect(result.current.tabs.tabs[0]).toMatchObject({ id: 'C:\\ws\\renamed.md', isDirty: false, isSaving: false })
    })
})

describe('recent folders', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        settingsState.workspace = { maxRecentFolders: 10 }
        vi.mocked(isTauri).mockReturnValue(true)
        mountDisk(createWindowsDisk({ 'C:\\ws\\notes.md': 'mine' }))
    })

    afterEach(() => {
        settingsState.workspace = { maxRecentFolders: 10 }
    })

    it('shows no more folders than the limit as soon as it is lowered, and keeps the rest until a folder is opened', async () => {
        const saved = ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d', 'C:\\e']
        vi.mocked(getRecentWorkspaces).mockResolvedValueOnce(saved)
        const { result, rerender } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.recentWorkspaces).toEqual(saved))

        // Typing '15' into the setting passes through '1'; that mustn't cut the saved list.
        settingsState.workspace = { maxRecentFolders: 1 }
        rerender()
        expect(result.current.session.recentWorkspaces).toEqual(['C:\\a'])
        settingsState.workspace = { maxRecentFolders: 3 }
        rerender()
        expect(result.current.session.recentWorkspaces).toEqual(['C:\\a', 'C:\\b', 'C:\\c'])

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        expect(addRecentWorkspace).toHaveBeenCalledWith('C:\\ws', 3)
    })

    it('leaves the open folder and its tabs alone when it is opened again, and only reads its files again', async () => {
        settingsState.autosave = { enabled: false, delayMs: 400 }
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        await act(async () => {
            await result.current.tabs.openFile('C:\\ws\\notes.md')
        })
        act(() => {
            result.current.tabs.updateTabContent('C:\\ws\\notes.md', 'unsaved edit')
        })
        const tabsBefore = result.current.tabs.tabs
        vi.mocked(readDir).mockClear()
        vi.mocked(addRecentWorkspace).mockClear()

        await act(async () => {
            await result.current.session.openWorkspace('c:/WS/')
        })

        expect(result.current.session.workspaceRoot).toBe('C:\\ws')
        expect(result.current.tabs.tabs).toBe(tabsBefore)
        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'unsaved edit', isDirty: true })
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\notes.md')
        expect(confirmUnsavedChanges).not.toHaveBeenCalled()
        expect(readDir).toHaveBeenCalledWith('C:\\ws')
        expect(addRecentWorkspace).toHaveBeenCalledWith('C:\\ws', 10)
    })
})

describe('folders opened and closed in the file tree', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\docs\\deep\\a.md': 'A', 'C:\\ws\\notes\\b.md': 'B', 'C:\\other\\c.md': 'C' })
        mountDisk(disk)
    })

    async function open(result: { current: ReturnType<typeof useHarness> }, path = 'C:\\ws') {
        await act(async () => {
            await result.current.session.openWorkspace(path)
        })
    }

    it('keeps each choice for as long as the folder is open, and remembers it for next time', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)

        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs', false))
        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs\\deep', true))

        expect([...result.current.session.folderToggles]).toEqual([
            ['C:\\ws\\docs', false],
            ['C:\\ws\\docs\\deep', true],
        ])
        expect(vi.mocked(setFolderToggles).mock.calls.at(-1)).toEqual(['C:\\ws', result.current.session.folderToggles])
    })

    it('opens a folder with the choices remembered for it, and the next folder without them', async () => {
        vi.mocked(getFolderToggles).mockImplementation(async (root) => (root === 'C:\\ws' ? [['C:\\ws\\docs', false]] : []))
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        await waitFor(() => expect(result.current.session.folderToggles.get('C:\\ws\\docs')).toBe(false))

        await open(result, 'C:\\other')

        expect(result.current.session.folderToggles.size).toBe(0)
    })

    it('keeps a choice made while the remembered ones are still being read', async () => {
        let finishReading!: (toggles: Array<[string, boolean]>) => void
        vi.mocked(getFolderToggles).mockImplementation(() => new Promise((resolve) => (finishReading = resolve)))
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)

        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs', true))
        await act(async () =>
            finishReading([
                ['C:\\ws\\docs', false],
                ['C:\\ws\\notes', false],
            ])
        )

        expect(Object.fromEntries(result.current.session.folderToggles)).toEqual({ 'C:\\ws\\docs': true, 'C:\\ws\\notes': false })
        expect(vi.mocked(setFolderToggles).mock.calls.at(-1)).toEqual(['C:\\ws', result.current.session.folderToggles])
    })

    it('moves the choices with a renamed folder and drops them for a deleted one', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await open(result)
        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs', true))
        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs\\deep', false))
        act(() => result.current.session.setFolderExpanded('C:\\ws\\notes', false))

        // The stand-in disk renames files only; this moves a folder and what is in it.
        vi.mocked(rename).mockImplementation(async (from, to) => {
            const prefix = `${String(from)}\\`.toLowerCase()
            for (const [key, file] of [...disk.contents]) {
                if (!key.startsWith(prefix)) continue
                disk.contents.delete(key)
                const path = `${String(to)}${file.path.slice(String(from).length)}`
                disk.contents.set(path.toLowerCase(), { path, text: file.text })
            }
        })
        await act(async () => {
            await result.current.session.renameEntry('C:\\ws\\docs', 'manual', true)
        })
        expect(Object.fromEntries(result.current.session.folderToggles)).toEqual({
            'C:\\ws\\manual': true,
            'C:\\ws\\manual\\deep': false,
            'C:\\ws\\notes': false,
        })

        await act(async () => {
            await result.current.session.deleteEntry('C:\\ws\\notes', true)
        })
        expect(Object.fromEntries(result.current.session.folderToggles)).toEqual({ 'C:\\ws\\manual': true, 'C:\\ws\\manual\\deep': false })
    })

    it('keeps the same function to call, so tree rows that use it are not drawn again', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        const first = result.current.session.setFolderExpanded
        await open(result)
        act(() => result.current.session.setFolderExpanded('C:\\ws\\docs', false))

        expect(result.current.session.setFolderExpanded).toBe(first)
    })
})

describe('reopening the last folder at startup', () => {
    let disk: ReturnType<typeof createWindowsDisk>

    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: false, delayMs: 400 }
        settingsState.workspace = { maxRecentFolders: 10, reopenLastFolder: true }
        vi.mocked(isTauri).mockReturnValue(true)
        disk = createWindowsDisk({ 'C:\\ws\\notes.md': 'mine', 'C:\\ws\\other.md': 'other', 'D:\\else\\x.md': 'x' })
        mountDisk(disk)
    })

    it('leaves alone a folder the user picks while Scrivon is still starting', async () => {
        let answer!: (path: string | null) => void
        vi.mocked(getLastWorkspace).mockReturnValue(new Promise((resolve) => (answer = resolve)))
        let finishReading!: () => void
        const reading = new Promise<void>((resolve) => (finishReading = resolve))
        vi.mocked(readDir).mockImplementation((async (dir: string) => {
            if (String(dir).startsWith('D:')) await reading
            return disk.list(String(dir))
        }) as unknown as typeof readDir)
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.hydrated).toBe(true))

        let picked!: Promise<void>
        act(() => {
            picked = result.current.session.openWorkspace('D:\\else')
        })
        await act(async () => answer('C:\\ws'))
        await act(async () => {
            finishReading()
            await picked
        })

        expect(result.current.session.workspaceRoot).toBe('D:\\else')
        expect(notifyError).not.toHaveBeenCalled()
    })

    afterEach(() => {
        settingsState.workspace = { maxRecentFolders: 10 }
        vi.mocked(getLastWorkspace).mockReset()
        vi.mocked(getLastWorkspace).mockResolvedValue(null)
        vi.mocked(getWorkspaceTabSession).mockReset()
        vi.mocked(getWorkspaceTabSession).mockResolvedValue(null)
        vi.mocked(listUnsavedBackups).mockReset()
        vi.mocked(listUnsavedBackups).mockResolvedValue([])
    })

    /** Lets the work started at launch run to its end. */
    async function settle() {
        for (let i = 0; i < 5; i++) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0))
            })
        }
    }

    it('reopens the folder and the files that were open when Scrivon closed', async () => {
        vi.mocked(getLastWorkspace).mockResolvedValue('C:\\ws')
        vi.mocked(getWorkspaceTabSession).mockResolvedValue({ tabIds: ['C:\\ws\\notes.md', 'C:\\ws\\other.md'], activeTabId: 'C:\\ws\\other.md' })
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.session.workspaceRoot).toBe('C:\\ws'))
        await waitFor(() => expect(result.current.tabs.tabs.map((t) => t.id)).toEqual(['C:\\ws\\notes.md', 'C:\\ws\\other.md']))
        expect(result.current.tabs.activeTabId).toBe('C:\\ws\\other.md')
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('starts with no folder open when the setting is off', async () => {
        settingsState.workspace = { maxRecentFolders: 10, reopenLastFolder: false }
        vi.mocked(getLastWorkspace).mockResolvedValue('C:\\ws')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.session.hydrated).toBe(true))
        await settle()
        expect(result.current.session.workspaceRoot).toBeNull()
        expect(readDir).not.toHaveBeenCalled()
    })

    it('starts with no folder open, and says why, when the folder is gone', async () => {
        vi.mocked(getRecentWorkspaces).mockResolvedValueOnce(['C:\\gone', 'C:\\ws'])
        vi.mocked(getLastWorkspace).mockResolvedValue('C:\\gone')
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith("Couldn't reopen gone", expect.anything(), {
                action: { label: 'Remove from Recent', onClick: expect.any(Function) },
            })
        )
        await settle()
        expect(result.current.session.hydrated).toBe(true)
        expect(result.current.session.workspaceRoot).toBeNull()
        expect(result.current.session.openingWorkspace).toBeNull()
    })

    it('remembers the open folder, and none once it is closed', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await waitFor(() => expect(result.current.session.hydrated).toBe(true))

        await act(async () => {
            await result.current.session.openWorkspace('C:\\ws')
        })
        expect(setLastWorkspace).toHaveBeenLastCalledWith('C:\\ws')

        await act(async () => {
            await result.current.session.closeWorkspace()
        })
        expect(setLastWorkspace).toHaveBeenLastCalledWith(null)
    })

    it('brings back unsaved changes kept for the reopened folder in its tabs, without asking to open it', async () => {
        vi.mocked(getLastWorkspace).mockResolvedValue('C:\\ws')
        vi.mocked(listUnsavedBackups).mockResolvedValue([
            { path: 'C:\\ws\\notes.md', root: 'C:\\ws', content: 'typed before the crash', stamp: { mtimeMs: 1, size: 4 }, savedAt: 1 },
        ])
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'typed before the crash', isDirty: true }))
        await settle()
        expect(notifyWarning).not.toHaveBeenCalledWith('Unsaved changes from last time', expect.anything())
    })

    it('still mentions unsaved changes kept for another folder', async () => {
        vi.mocked(getLastWorkspace).mockResolvedValue('C:\\gone')
        vi.mocked(listUnsavedBackups).mockResolvedValue([
            { path: 'D:\\else\\x.md', root: 'D:\\else', content: 'typed before the crash', stamp: { mtimeMs: 1, size: 1 }, savedAt: 1 },
        ])
        renderHook(useHarness, { wrapper: createWrapper() })

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't reopen gone", expect.anything(), expect.anything()))
        await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith('Unsaved changes from last time', expect.anything()))
    })
})
