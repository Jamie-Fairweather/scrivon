'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { pickWorkspaceFolder, showError } from '@/lib/tauri/dialog'
import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getBaseName,
    getParentPath,
    joinPath,
    listWorkspaceTree,
    readWorkspaceFile,
    removeWorkspacePath,
    renameWorkspacePath,
    writeWorkspaceFile,
} from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'
import { addRecentWorkspace, getLastOpenedFile, getRecentWorkspaces, removeRecentWorkspace, setLastOpenedFile } from '@/lib/tauri/store'
import { collectFileNames, uniqueFileName, uniqueUntitledName, validateFileName } from '@/lib/workspace/paths'
import {
    AUTO_SAVE_MS,
    STORAGE_LAYOUT_EDITOR,
    STORAGE_LAYOUT_EXPLORER,
    type DocumentTab,
    type FileNode,
    type StudioLayoutState,
} from '@/lib/workspace/types'

type WorkspaceContextValue = {
    isDesktop: boolean
    hydrated: boolean
    workspaceRoot: string | null
    workspaceName: string | null
    tree: FileNode[]
    recentWorkspaces: string[]
    tabs: DocumentTab[]
    activeTabId: string | null
    activeTab: DocumentTab | null
    layout: StudioLayoutState
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setPreviewOnly: () => void
    pickAndOpenWorkspace: () => Promise<void>
    openWorkspace: (path: string) => Promise<void>
    closeWorkspace: () => Promise<void>
    refreshTree: () => Promise<void>
    openFile: (path: string) => Promise<void>
    setActiveTab: (id: string) => Promise<void>
    updateTabContent: (id: string, content: string) => void
    closeTab: (id: string) => Promise<void>
    flushSave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    removeRecent: (path: string) => Promise<void>
    createFile: (parentPath: string, name: string, content?: string) => Promise<void>
    createFolder: (parentPath: string, name: string) => Promise<void>
    renameEntry: (oldPath: string, newName: string) => Promise<void>
    deleteEntry: (path: string, isDirectory: boolean) => Promise<void>
    duplicateFile: (path: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
    const ctx = useContext(WorkspaceContext)
    if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
    return ctx
}

function tabFromPath(path: string, content: string): DocumentTab {
    return {
        id: path,
        path,
        name: getBaseName(path),
        content,
        isDirty: false,
        isSaving: false,
    }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const isDesktop = isTauri()
    const [hydrated, setHydrated] = useState(false)
    const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
    const [tree, setTree] = useState<FileNode[]>([])
    const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([])
    const [tabs, setTabs] = useState<DocumentTab[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const [layout, setLayout] = useState<StudioLayoutState>({
        explorerOpen: true,
        editorOpen: true,
    })

    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const tabsRef = useRef(tabs)
    tabsRef.current = tabs

    const workspaceName = workspaceRoot ? getBaseName(workspaceRoot) : null
    const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId])

    useEffect(() => {
        const explorer = localStorage.getItem(STORAGE_LAYOUT_EXPLORER)
        const editor = localStorage.getItem(STORAGE_LAYOUT_EDITOR)
        setLayout({
            explorerOpen: explorer !== 'false',
            editorOpen: editor !== 'false',
        })
        void getRecentWorkspaces().then(setRecentWorkspaces)
        setHydrated(true)
    }, [])

    const persistLayout = useCallback((next: StudioLayoutState) => {
        setLayout(next)
        localStorage.setItem(STORAGE_LAYOUT_EXPLORER, String(next.explorerOpen))
        localStorage.setItem(STORAGE_LAYOUT_EDITOR, String(next.editorOpen))
    }, [])

    const setExplorerOpen = useCallback((open: boolean) => {
        setLayout((prev) => {
            const next = { ...prev, explorerOpen: open }
            localStorage.setItem(STORAGE_LAYOUT_EXPLORER, String(open))
            return next
        })
    }, [])

    const setEditorOpen = useCallback((open: boolean) => {
        setLayout((prev) => {
            const next = { ...prev, editorOpen: open }
            localStorage.setItem(STORAGE_LAYOUT_EDITOR, String(open))
            return next
        })
    }, [])

    const setPreviewOnly = useCallback(() => persistLayout({ explorerOpen: false, editorOpen: false }), [persistLayout])

    const refreshTree = useCallback(async () => {
        if (!workspaceRoot) return
        const next = await listWorkspaceTree(workspaceRoot)
        setTree(next)
    }, [workspaceRoot])

    const flushSave = useCallback(async (id: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
        const timer = saveTimers.current.get(id)
        if (timer) {
            clearTimeout(timer)
            saveTimers.current.delete(id)
        }

        const tab = tabsRef.current.find((t) => t.id === id)
        if (!tab || !tab.isDirty) return true

        if (!silent) {
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: true, saveError: undefined } : t)))
        }

        try {
            await writeWorkspaceFile(tab.path, tab.content)
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isDirty: false, isSaving: false, saveError: undefined } : t)))
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save file'
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: false, saveError: message } : t)))
            return false
        }
    }, [])

    const flushAllSaves = useCallback(async (): Promise<boolean> => {
        const dirtyIds = tabsRef.current.filter((t) => t.isDirty).map((t) => t.id)
        const results = await Promise.all(dirtyIds.map((id) => flushSave(id)))
        return results.every(Boolean)
    }, [flushSave])

    const scheduleSave = useCallback(
        (id: string) => {
            const existing = saveTimers.current.get(id)
            if (existing) clearTimeout(existing)

            const timer = setTimeout(() => {
                saveTimers.current.delete(id)
                void flushSave(id)
            }, AUTO_SAVE_MS)

            saveTimers.current.set(id, timer)
        },
        [flushSave]
    )

    const openFile = useCallback(
        async (path: string) => {
            const previousId = activeTabId

            const existing = tabsRef.current.find((t) => t.id === path)
            if (existing) {
                setActiveTabId(path)
                if (workspaceRoot) void setLastOpenedFile(workspaceRoot, path)
                if (previousId && previousId !== path) void flushSave(previousId, { silent: true })
                return
            }

            if (previousId && previousId !== path) void flushSave(previousId, { silent: true })

            try {
                const content = await readWorkspaceFile(path)
                const tab = tabFromPath(path, content)
                setTabs((prev) => [...prev, tab])
                setActiveTabId(path)
                if (workspaceRoot) await setLastOpenedFile(workspaceRoot, path)
            } catch (err) {
                await showError('Open failed', err instanceof Error ? err.message : 'Could not read file')
            }
        },
        [activeTabId, flushSave, workspaceRoot]
    )

    const openWorkspace = useCallback(
        async (path: string) => {
            if (!isDesktop) return

            await allowWorkspacePath(path)
            if (workspaceRoot) await flushAllSaves()

            const nextTree = await listWorkspaceTree(path)
            const recents = await addRecentWorkspace(path)

            setWorkspaceRoot(path)
            setTree(nextTree)
            setRecentWorkspaces(recents)
            setTabs([])
            setActiveTabId(null)

            const lastFile = await getLastOpenedFile(path)
            if (lastFile) {
                try {
                    const content = await readWorkspaceFile(lastFile)
                    const tab = tabFromPath(lastFile, content)
                    setTabs([tab])
                    setActiveTabId(lastFile)
                } catch {
                    // ignore missing last file
                }
            }
        },
        [isDesktop, workspaceRoot, flushAllSaves]
    )

    const pickAndOpenWorkspace = useCallback(async () => {
        const path = await pickWorkspaceFolder()
        if (path) await openWorkspace(path)
    }, [openWorkspace])

    const closeWorkspace = useCallback(async () => {
        await flushAllSaves()
        for (const timer of saveTimers.current.values()) clearTimeout(timer)
        saveTimers.current.clear()
        setWorkspaceRoot(null)
        setTree([])
        setTabs([])
        setActiveTabId(null)
    }, [flushAllSaves])

    const removeRecent = useCallback(async (path: string) => {
        const next = await removeRecentWorkspace(path)
        setRecentWorkspaces(next)
    }, [])

    const setActiveTab = useCallback(
        async (id: string) => {
            if (activeTabId === id) return
            const previousId = activeTabId
            setActiveTabId(id)
            if (workspaceRoot) void setLastOpenedFile(workspaceRoot, id)
            if (previousId) void flushSave(previousId, { silent: true })
        },
        [activeTabId, flushSave, workspaceRoot]
    )

    const updateTabContent = useCallback(
        (id: string, content: string) => {
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content, isDirty: true, saveError: undefined } : t)))
            scheduleSave(id)
        },
        [scheduleSave]
    )

    const closeTab = useCallback(
        async (id: string) => {
            await flushSave(id)
            setTabs((prev) => {
                const next = prev.filter((t) => t.id !== id)
                if (activeTabId === id) {
                    const closedIndex = prev.findIndex((t) => t.id === id)
                    const fallback = next[Math.min(closedIndex, next.length - 1)]
                    setActiveTabId(fallback?.id ?? null)
                }
                return next
            })
        },
        [activeTabId, flushSave]
    )

    const createFile = useCallback(
        async (parentPath: string, name: string, content = DEFAULT_DIAGRAM) => {
            const error = validateFileName(name)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            const path = joinPath(parentPath, name)
            await createWorkspaceFile(path, content)
            await refreshTree()
            await openFile(path)
        },
        [refreshTree, openFile]
    )

    const createFolder = useCallback(
        async (parentPath: string, name: string) => {
            const error = validateFileName(name)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            const path = joinPath(parentPath, name)
            await createWorkspaceDirectory(path)
            await refreshTree()
        },
        [refreshTree]
    )

    const renameEntry = useCallback(
        async (oldPath: string, newName: string) => {
            const error = validateFileName(newName)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            const parent = getParentPath(oldPath)
            const newPath = joinPath(parent, newName)
            await renameWorkspacePath(oldPath, newPath)
            await refreshTree()

            setTabs((prev) =>
                prev.map((t) => {
                    if (t.path === oldPath) {
                        return {
                            ...t,
                            id: newPath,
                            path: newPath,
                            name: newName,
                        }
                    }
                    if (t.path.startsWith(oldPath + '/') || t.path.startsWith(oldPath + '\\')) {
                        const suffix = t.path.slice(oldPath.length)
                        const updated = newPath + suffix
                        return { ...t, id: updated, path: updated }
                    }
                    return t
                })
            )
            if (activeTabId === oldPath) setActiveTabId(newPath)
        },
        [refreshTree, activeTabId]
    )

    const deleteEntry = useCallback(
        async (path: string, isDirectory: boolean) => {
            await removeWorkspacePath(path)
            await refreshTree()

            const toClose = tabsRef.current.filter((t) => t.path === path || t.path.startsWith(path + '/') || t.path.startsWith(path + '\\'))
            for (const tab of toClose) {
                saveTimers.current.delete(tab.id)
            }
            setTabs((prev) => {
                const closingIds = new Set(toClose.map((t) => t.id))
                const next = prev.filter((t) => !closingIds.has(t.id))
                if (activeTabId && closingIds.has(activeTabId)) {
                    setActiveTabId(next[0]?.id ?? null)
                }
                return next
            })
        },
        [refreshTree, activeTabId]
    )

    const duplicateFile = useCallback(
        async (path: string) => {
            const parent = getParentPath(path)
            const baseName = getBaseName(path)
            const siblingNames = collectFileNames(tree)
            const newName = uniqueFileName(baseName, siblingNames)
            const destPath = joinPath(parent, newName)
            await duplicateWorkspaceFile(path, destPath)
            await refreshTree()
            await openFile(destPath)
        },
        [tree, refreshTree, openFile]
    )

    const value = useMemo<WorkspaceContextValue>(
        () => ({
            isDesktop,
            hydrated,
            workspaceRoot,
            workspaceName,
            tree,
            recentWorkspaces,
            tabs,
            activeTabId,
            activeTab,
            layout,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOnly,
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            refreshTree,
            openFile,
            setActiveTab,
            updateTabContent,
            closeTab,
            flushSave,
            flushAllSaves,
            removeRecent,
            createFile,
            createFolder,
            renameEntry,
            deleteEntry,
            duplicateFile,
        }),
        [
            isDesktop,
            hydrated,
            workspaceRoot,
            workspaceName,
            tree,
            recentWorkspaces,
            tabs,
            activeTabId,
            activeTab,
            layout,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOnly,
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            refreshTree,
            openFile,
            setActiveTab,
            updateTabContent,
            closeTab,
            flushSave,
            flushAllSaves,
            removeRecent,
            createFile,
            createFolder,
            renameEntry,
            deleteEntry,
            duplicateFile,
        ]
    )

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
