import { act, renderHook, waitFor } from '@testing-library/react'
import { useMemo, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { notifyError } from '@/lib/notify'
import { confirmCloseAfterSaveFailure, confirmUnsavedChanges } from '@/lib/tauri/dialog'
import { PathExistsError } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getWorkspaceTabSession } from '@/lib/tauri/store'
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

    it('suggests a default name nothing in the folder uses', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper() })
        await openWorkspace(result)

        expect(result.current.session.suggestName('C:\\ws', 'diagram.mmd')).toBe('diagram 2.mmd')
        expect(result.current.session.suggestName('C:\\ws\\docs', 'diagram.mmd')).toBe('diagram.mmd')
        expect(result.current.session.suggestName('C:\\ws', 'docs')).toBe('docs 2')
    })
})
