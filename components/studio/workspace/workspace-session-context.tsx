'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { DEFAULT_MARKDOWN } from '@/lib/default-markdown'
import { pickWorkspaceFolder } from '@/lib/tauri/dialog'
import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getBaseName,
    getParentPath,
    joinPath,
    listFolderNames,
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
import { childrenOf, entryNameError, uniqueFileName, uniqueNewName } from '@/lib/workspace/paths'
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
    /**
     * Why `name` can't be used for a new entry in `parentPath` (bad characters, wrong extension, already
     * taken), or null when it can. For a rename, `currentPath` is the entry being renamed.
     */
    getNameError: (parentPath: string, name: string, kind: FileNode['kind'], currentPath?: string) => string | null
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

    /** Re-reads the folder. A failure is reported rather than thrown, so the action that changed the disk still finishes. */
    const refreshTree = useCallback(async () => {
        if (!workspaceRoot) return
        try {
            setTree(await listWorkspaceTree(workspaceRoot))
        } catch (err) {
            notifyError("Couldn't refresh the file list", err)
        }
    }, [workspaceRoot])

    const removeRecent = useCallback(async (path: string) => {
        const next = await removeRecentWorkspace(path)
        setRecentWorkspaces(next)
    }, [])

    /** Reopens the tabs saved for this folder. Files that can't be read any more are skipped. */
    const restoreTabSession = useCallback(
        async (path: string) => {
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
        [coordinator]
    )

    const openWorkspace = useCallback(
        async (requestedPath: string) => {
            if (!isDesktop) return

            const path = normalizePath(requestedPath)
            let nextTree: FileNode[]
            let recents: string[]
            try {
                if (workspaceRoot) {
                    // Leaving the open folder closes its tabs, so unsaved or unsavable edits must be dealt with first.
                    if (!(await coordinator.confirmCloseTabs.current())) return
                    await coordinator.persistWorkspaceTabSession.current()
                }
                await allowWorkspacePath(path)
                nextTree = await listWorkspaceTree(path)
                recents = await addRecentWorkspace(path)
            } catch (err) {
                // Nothing has switched yet, so the folder that was open (if any) stays open.
                // A recent folder that was moved, deleted or is on a missing drive can be dropped from the list.
                const isRecent = (recentWorkspaces ?? []).some((p) => samePath(p, path))
                const removeFromRecent = () => void removeRecent(path).catch((e: unknown) => notifyError("Couldn't update recent folders", e))
                notifyError(
                    `Couldn't open ${getBaseName(path) || path}`,
                    err,
                    isRecent ? { action: { label: 'Remove from Recent', onClick: removeFromRecent } } : {}
                )
                return
            }

            setWorkspaceRoot(path)
            setTree(nextTree)
            setRecentWorkspaces(recents)
            coordinator.clearTabs.current()

            try {
                await restoreTabSession(path)
            } catch (err) {
                notifyError("Couldn't reopen the files you had open", err)
            }
        },
        [isDesktop, workspaceRoot, recentWorkspaces, removeRecent, restoreTabSession, coordinator]
    )

    const pickAndOpenWorkspace = useCallback(async () => {
        let path: string | null
        try {
            path = await pickWorkspaceFolder()
        } catch (err) {
            notifyError("Couldn't open the folder", err)
            return
        }
        if (path) await openWorkspace(path)
    }, [openWorkspace])

    const closeWorkspace = useCallback(async () => {
        if (!(await coordinator.confirmCloseTabs.current())) return
        await coordinator.persistWorkspaceTabSession.current()
        setWorkspaceRoot(null)
        setTree([])
        coordinator.clearTabs.current()
    }, [coordinator])

    const suggestName = useCallback(
        (parentPath: string, name: string) =>
            uniqueNewName(
                name,
                childrenOf(tree, workspaceRoot, parentPath).map((node) => node.name)
            ),
        [tree, workspaceRoot]
    )

    const getNameError = useCallback(
        (parentPath: string, name: string, kind: FileNode['kind'], currentPath?: string) =>
            entryNameError(name, kind, childrenOf(tree, workspaceRoot, parentPath), currentPath),
        [tree, workspaceRoot]
    )

    const createFile = useCallback(
        async (parentPath: string, name: string, content?: string) => {
            const failed = `Couldn't create ${name}`
            // The name prompt checks this as the user types; it is repeated for any other caller. A taken name
            // is refused because writing a new file over an existing one would wipe it (the write refuses it too).
            const problem = getNameError(parentPath, name, 'file')
            if (problem) {
                notifyError(failed, undefined, { description: problem })
                return
            }
            const resolvedContent = content ?? (isMarkdownFile(name) ? DEFAULT_MARKDOWN : DEFAULT_DIAGRAM)
            const path = joinPath(parentPath, name)
            try {
                await createWorkspaceFile(path, resolvedContent)
            } catch (err) {
                notifyError(failed, err)
                await refreshTree()
                return
            }
            await refreshTree()
            await coordinator.openFile.current(path)
        },
        [getNameError, refreshTree, coordinator]
    )

    const createFolder = useCallback(
        async (parentPath: string, name: string) => {
            const failed = `Couldn't create folder ${name}`
            const problem = getNameError(parentPath, name, 'directory')
            if (problem) {
                notifyError(failed, undefined, { description: problem })
                return
            }
            const path = joinPath(parentPath, name)
            try {
                await createWorkspaceDirectory(path)
            } catch (err) {
                notifyError(failed, err)
                await refreshTree()
                return
            }
            await refreshTree()
        },
        [getNameError, refreshTree]
    )

    const renameEntry = useCallback(
        async (oldPath: string, newName: string, isDirectory: boolean) => {
            const failed = `Couldn't rename ${getBaseName(oldPath)}`
            const parent = getParentPath(oldPath)
            // Renaming onto a taken name would replace that file, so it's refused here and again on disk.
            // The entry itself is left out of the check, so a change of letter case only still works.
            const problem = getNameError(parent, newName, isDirectory ? 'directory' : 'file', oldPath)
            if (problem) {
                notifyError(failed, undefined, { description: problem })
                return
            }
            const newPath = joinPath(parent, newName)
            try {
                await renameWorkspacePath(oldPath, newPath)
            } catch (err) {
                notifyError(failed, err)
                await refreshTree()
                return
            }
            await refreshTree()
            coordinator.remapTabsAfterRename.current(oldPath, newPath, newName)
        },
        [getNameError, refreshTree, coordinator]
    )

    const deleteEntry = useCallback(
        async (path: string, isDirectory: boolean) => {
            try {
                // The user confirmed deleting the folder and everything in it; without recursive a folder that isn't empty is refused.
                await removeWorkspacePath(path, { recursive: isDirectory })
            } catch (err) {
                // Its tabs stay open: the file (or some of the folder) may still be there.
                notifyError(`Couldn't delete ${getBaseName(path)}`, err)
                await refreshTree()
                return
            }
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
            let destPath: string
            try {
                // Names in use come from the folder on disk, not the cached tree, so a file added elsewhere
                // since the last reload is seen (the copy itself also refuses to replace anything).
                const newName = uniqueFileName(baseName, await listFolderNames(parent))
                destPath = joinPath(parent, newName)
                // The copy holds what the user sees, including edits that aren't saved yet.
                await duplicateWorkspaceFile(path, destPath, coordinator.getUnsavedContent.current(path))
            } catch (err) {
                notifyError(`Couldn't duplicate ${baseName}`, err)
                await refreshTree()
                return
            }
            await refreshTree()
            await coordinator.openFile.current(destPath)
        },
        [refreshTree, coordinator]
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
            getNameError,
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
            getNameError,
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
