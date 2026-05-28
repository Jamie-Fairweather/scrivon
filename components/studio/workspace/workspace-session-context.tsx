'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { DEFAULT_MARKDOWN } from '@/lib/default-markdown'
import { pickWorkspaceFolder, showError } from '@/lib/tauri/dialog'
import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getBaseName,
    getParentPath,
    isSupportedDocument,
    joinPath,
    listWorkspaceTree,
    readWorkspaceFile,
    removeWorkspacePath,
    renameWorkspacePath,
} from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'
import { addRecentWorkspace, getRecentWorkspaces, getWorkspaceTabSession, removeRecentWorkspace } from '@/lib/tauri/store'
import { tabFromPath } from '@/lib/workspace/document-tab'
import { isMarkdownFile } from '@/lib/workspace/file-types'
import { collectFileNames, uniqueFileName, validateFileName } from '@/lib/workspace/paths'
import type { FileNode } from '@/lib/workspace/types'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type WorkspaceSessionContextValue = {
    isDesktop: boolean
    hydrated: boolean
    workspaceRoot: string | null
    workspaceName: string | null
    tree: FileNode[]
    recentWorkspaces: string[]
    pickAndOpenWorkspace: () => Promise<void>
    openWorkspace: (path: string) => Promise<void>
    closeWorkspace: () => Promise<void>
    refreshTree: () => Promise<void>
    removeRecent: (path: string) => Promise<void>
    createFile: (parentPath: string, name: string, content?: string) => Promise<void>
    createFolder: (parentPath: string, name: string) => Promise<void>
    renameEntry: (oldPath: string, newName: string, isDirectory: boolean) => Promise<void>
    deleteEntry: (path: string, isDirectory: boolean) => Promise<void>
    duplicateFile: (path: string) => Promise<void>
    openFile: (path: string) => Promise<void>
}

const WorkspaceSessionContext = createContext<WorkspaceSessionContextValue | null>(null)

export function useWorkspaceSession(): WorkspaceSessionContextValue {
    const ctx = useContext(WorkspaceSessionContext)
    if (!ctx) throw new Error('useWorkspaceSession must be used within WorkspaceProvider')
    return ctx
}

type WorkspaceSessionProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
}

export function WorkspaceSessionProvider({ children, coordinator }: WorkspaceSessionProviderProps) {
    const isDesktop = isTauri()
    const [hydrated, setHydrated] = useState(false)
    const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
    const [tree, setTree] = useState<FileNode[]>([])
    const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([])

    const workspaceName = workspaceRoot ? getBaseName(workspaceRoot) : null

    useEffect(() => {
        void getRecentWorkspaces().then(setRecentWorkspaces)
        setHydrated(true)
    }, [])

    const refreshTree = useCallback(async () => {
        if (!workspaceRoot) return
        const next = await listWorkspaceTree(workspaceRoot)
        setTree(next)
    }, [workspaceRoot])

    const openWorkspace = useCallback(
        async (path: string) => {
            if (!isDesktop) return

            await allowWorkspacePath(path)
            if (workspaceRoot) {
                await coordinator.flushAllSaves.current()
                await coordinator.persistWorkspaceTabSession.current()
            }

            const nextTree = await listWorkspaceTree(path)
            const recents = await addRecentWorkspace(path)

            setWorkspaceRoot(path)
            setTree(nextTree)
            setRecentWorkspaces(recents)
            coordinator.clearTabs.current()

            const tabSession = await getWorkspaceTabSession(path)
            if (tabSession && tabSession.tabIds.length > 0) {
                const restoredTabs = (
                    await Promise.all(
                        tabSession.tabIds.map(async (filePath) => {
                            try {
                                const content = await readWorkspaceFile(filePath)
                                return tabFromPath(filePath, content)
                            } catch {
                                return null
                            }
                        })
                    )
                ).filter((tab): tab is NonNullable<typeof tab> => tab !== null)

                if (restoredTabs.length > 0) {
                    const restoredIds = new Set(restoredTabs.map((t) => t.id))
                    const activeId = tabSession.activeTabId && restoredIds.has(tabSession.activeTabId) ? tabSession.activeTabId : restoredTabs[0].id
                    coordinator.setTabsFromWorkspace.current(restoredTabs, activeId)
                    coordinator.requestCanvasFit.current()
                }
            }
        },
        [isDesktop, workspaceRoot, coordinator]
    )

    const pickAndOpenWorkspace = useCallback(async () => {
        const path = await pickWorkspaceFolder()
        if (path) await openWorkspace(path)
    }, [openWorkspace])

    const closeWorkspace = useCallback(async () => {
        await coordinator.flushAllSaves.current()
        await coordinator.persistWorkspaceTabSession.current()
        setWorkspaceRoot(null)
        setTree([])
        coordinator.clearTabs.current()
    }, [coordinator])

    const removeRecent = useCallback(async (path: string) => {
        const next = await removeRecentWorkspace(path)
        setRecentWorkspaces(next)
    }, [])

    const createFile = useCallback(
        async (parentPath: string, name: string, content?: string) => {
            const error = validateFileName(name)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            if (!isSupportedDocument(name)) {
                await showError('Unsupported file', 'File name must end with .md or .mmd.')
                return
            }
            const resolvedContent = content ?? (isMarkdownFile(name) ? DEFAULT_MARKDOWN : DEFAULT_DIAGRAM)
            const path = joinPath(parentPath, name)
            await createWorkspaceFile(path, resolvedContent)
            await refreshTree()
            await coordinator.openFile.current(path)
        },
        [refreshTree, coordinator]
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
        async (oldPath: string, newName: string, isDirectory: boolean) => {
            const error = validateFileName(newName)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            if (!isDirectory && !isSupportedDocument(newName)) {
                await showError('Unsupported file', 'File name must end with .md or .mmd.')
                return
            }
            const parent = getParentPath(oldPath)
            const newPath = joinPath(parent, newName)
            await renameWorkspacePath(oldPath, newPath)
            await refreshTree()
            coordinator.remapTabsAfterRename.current(oldPath, newPath, newName)
        },
        [refreshTree, coordinator]
    )

    const deleteEntry = useCallback(
        async (path: string, isDirectory: boolean) => {
            await removeWorkspacePath(path)
            await refreshTree()
            coordinator.closeTabsForDelete.current(path, isDirectory)
        },
        [refreshTree, coordinator]
    )

    const openFile = useCallback((path: string) => coordinator.openFile.current(path), [coordinator])

    const duplicateFile = useCallback(
        async (path: string) => {
            const parent = getParentPath(path)
            const baseName = getBaseName(path)
            const siblingNames = collectFileNames(tree)
            const newName = uniqueFileName(baseName, siblingNames)
            const destPath = joinPath(parent, newName)
            await duplicateWorkspaceFile(path, destPath)
            await refreshTree()
            await coordinator.openFile.current(destPath)
        },
        [tree, refreshTree, coordinator]
    )

    const value = useMemo(
        () => ({
            isDesktop,
            hydrated,
            workspaceRoot,
            workspaceName,
            tree,
            recentWorkspaces,
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            refreshTree,
            removeRecent,
            createFile,
            createFolder,
            renameEntry,
            deleteEntry,
            duplicateFile,
            openFile,
        }),
        [
            isDesktop,
            hydrated,
            workspaceRoot,
            workspaceName,
            tree,
            recentWorkspaces,
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            refreshTree,
            removeRecent,
            createFile,
            createFolder,
            renameEntry,
            deleteEntry,
            duplicateFile,
            openFile,
        ]
    )

    return <WorkspaceSessionContext.Provider value={value}>{children}</WorkspaceSessionContext.Provider>
}
