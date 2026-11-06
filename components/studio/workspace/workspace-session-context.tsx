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
    normalizePath,
    readWorkspaceFile,
    removeWorkspacePath,
    renameWorkspacePath,
    samePath,
} from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'
import { addRecentWorkspace, getRecentWorkspaces, getWorkspaceTabSession, removeRecentWorkspace } from '@/lib/tauri/store'
import { tabFromPath } from '@/lib/workspace/document-tab'
import { notifyError } from '@/lib/notify'
import { isMarkdownFile } from '@/lib/workspace/file-types'
import { childrenOf, collectFileNames, findNameClash, nameTakenMessage, uniqueFileName, uniqueNewName, validateFileName } from '@/lib/workspace/paths'
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
    /** `name`, or `name 2`, `name 3`… so it doesn't clash with anything already in `parentPath`. */
    suggestName: (parentPath: string, name: string) => string
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
    const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
    const [tree, setTree] = useState<FileNode[]>([])
    const [recentWorkspaces, setRecentWorkspaces] = useState<string[] | null>(null)
    const hydrated = recentWorkspaces !== null

    const workspaceName = workspaceRoot ? getBaseName(workspaceRoot) : null

    useEffect(() => {
        void getRecentWorkspaces()
            .then(setRecentWorkspaces)
            .catch(() => setRecentWorkspaces([]))
    }, [])

    const refreshTree = useCallback(async () => {
        if (!workspaceRoot) return
        const next = await listWorkspaceTree(workspaceRoot)
        setTree(next)
    }, [workspaceRoot])

    const openWorkspace = useCallback(
        async (requestedPath: string) => {
            if (!isDesktop) return

            const path = normalizePath(requestedPath)
            if (workspaceRoot) {
                // Leaving the open folder closes its tabs, so unsaved or unsavable edits must be dealt with first.
                if (!(await coordinator.confirmCloseTabs.current())) return
                await coordinator.persistWorkspaceTabSession.current()
            }
            await allowWorkspacePath(path)

            const nextTree = await listWorkspaceTree(path)
            const recents = await addRecentWorkspace(path)

            setWorkspaceRoot(path)
            setTree(nextTree)
            setRecentWorkspaces(recents)
            coordinator.clearTabs.current()

            const tabSession = await getWorkspaceTabSession(path)
            if (tabSession && tabSession.tabIds.length > 0) {
                // Older sessions can hold the same file twice with different separators.
                const sessionPaths: string[] = []
                for (const id of tabSession.tabIds) {
                    const normalized = normalizePath(id)
                    if (!sessionPaths.some((p) => samePath(p, normalized))) sessionPaths.push(normalized)
                }
                const restoredTabs = (
                    await Promise.all(
                        sessionPaths.map(async (filePath) => {
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
                    const savedActiveId = tabSession.activeTabId
                    const activeTab = savedActiveId ? restoredTabs.find((t) => samePath(t.path, savedActiveId)) : undefined
                    const activeId = activeTab?.id ?? restoredTabs[0].id
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
        if (!(await coordinator.confirmCloseTabs.current())) return
        await coordinator.persistWorkspaceTabSession.current()
        setWorkspaceRoot(null)
        setTree([])
        coordinator.clearTabs.current()
    }, [coordinator])

    const removeRecent = useCallback(async (path: string) => {
        const next = await removeRecentWorkspace(path)
        setRecentWorkspaces(next)
    }, [])

    const suggestName = useCallback(
        (parentPath: string, name: string) =>
            uniqueNewName(
                name,
                childrenOf(tree, workspaceRoot, parentPath).map((node) => node.name)
            ),
        [tree, workspaceRoot]
    )

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
            const failed = `Couldn't create ${name}`
            // Writing a new file over an existing one would wipe it, so a taken name is refused here and again on disk.
            const clash = findNameClash(childrenOf(tree, workspaceRoot, parentPath), name)
            if (clash) {
                notifyError(failed, undefined, { description: nameTakenMessage(clash) })
                return
            }
            const resolvedContent = content ?? (isMarkdownFile(name) ? DEFAULT_MARKDOWN : DEFAULT_DIAGRAM)
            const path = joinPath(parentPath, name)
            try {
                await createWorkspaceFile(path, resolvedContent)
            } catch (err) {
                notifyError(failed, err)
                return
            }
            await refreshTree()
            await coordinator.openFile.current(path)
        },
        [tree, workspaceRoot, refreshTree, coordinator]
    )

    const createFolder = useCallback(
        async (parentPath: string, name: string) => {
            const error = validateFileName(name)
            if (error) {
                await showError('Invalid name', error)
                return
            }
            const failed = `Couldn't create folder ${name}`
            const clash = findNameClash(childrenOf(tree, workspaceRoot, parentPath), name)
            if (clash) {
                notifyError(failed, undefined, { description: nameTakenMessage(clash) })
                return
            }
            const path = joinPath(parentPath, name)
            try {
                await createWorkspaceDirectory(path)
            } catch (err) {
                notifyError(failed, err)
                return
            }
            await refreshTree()
        },
        [tree, workspaceRoot, refreshTree]
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
            const failed = `Couldn't rename ${getBaseName(oldPath)}`
            const parent = getParentPath(oldPath)
            // Renaming onto a taken name would replace that file, so it's refused here and again on disk.
            // The entry itself is left out of the check, so a change of letter case only still works.
            const clash = findNameClash(childrenOf(tree, workspaceRoot, parent), newName, oldPath)
            if (clash) {
                notifyError(failed, undefined, { description: nameTakenMessage(clash) })
                return
            }
            const newPath = joinPath(parent, newName)
            try {
                await renameWorkspacePath(oldPath, newPath)
            } catch (err) {
                notifyError(failed, err)
                return
            }
            await refreshTree()
            coordinator.remapTabsAfterRename.current(oldPath, newPath, newName)
        },
        [tree, workspaceRoot, refreshTree, coordinator]
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
            recentWorkspaces: recentWorkspaces ?? [],
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            refreshTree,
            removeRecent,
            suggestName,
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
            suggestName,
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
