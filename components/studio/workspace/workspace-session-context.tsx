'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { DEFAULT_MARKDOWN } from '@/lib/default-markdown'
import { pickWorkspaceFolder } from '@/lib/tauri/dialog'
import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getBaseName,
    getParentPath,
    isHiddenFolder,
    isPathInside,
    joinPath,
    listFolderNames,
    listWorkspaceTree,
    normalizePath,
    readWorkspaceTextFile,
    removeWorkspacePath,
    renameWorkspacePath,
    samePath,
} from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'
import { deleteUnsavedBackup, listUnsavedBackups, type UnsavedBackup } from '@/lib/tauri/backups'
import { addRecentWorkspace, clampRecentWorkspaceLimit, getRecentWorkspaces, getWorkspaceTabSession, removeRecentWorkspace } from '@/lib/tauri/store'
import { tabFromFile, tabWithRecoveredText } from '@/lib/workspace/document-tab'
import { dismissNotification, notifyError, notifyInfo, notifyWarning } from '@/lib/notify'
import { isMarkdownFile } from '@/lib/workspace/file-types'
import { childrenOf, collectUnreadableFolders, entryNameError, uniqueFileName, uniqueNewName } from '@/lib/workspace/paths'
import { remapPathAfterRename } from '@/lib/workspace/tab-paths'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

type WorkspaceSessionContextValue = {
    isDesktop: boolean
    hydrated: boolean
    workspaceRoot: string | null
    workspaceName: string | null
    /** The folder being opened right now (reading a big one takes a while), or null. */
    openingWorkspace: string | null
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

const RECOVERED_CHANGES_NOTICE_ID = 'recovered-changes'
const OPENING_NOTICE_ID = 'opening-folder'
/** Opening a folder that takes longer than this shows a notice, so a slow open doesn't look like nothing happened. */
const OPENING_NOTICE_DELAY_MS = 400

/** The copies of unsaved text kept from earlier; none when they can't be read (they are only a safety net). */
async function listBackupsSafely(): Promise<UnsavedBackup[]> {
    try {
        return await listUnsavedBackups()
    } catch (err) {
        console.warn("Couldn't read the copies of unsaved changes", err)
        return []
    }
}

/** Tells the user which folders show up empty because they couldn't be read (the rest of the folder still opens). */
function warnAboutUnreadableFolders(tree: FileNode[]) {
    const folders = collectUnreadableFolders(tree)
    if (folders.length === 0) return
    if (folders.length === 1) {
        notifyWarning(`Couldn't read the folder ${folders[0]!.name}`, {
            description: 'It shows as empty. Scrivon may not have permission to open it.',
        })
        return
    }
    const names = folders
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')
    const more = folders.length > 3 ? ` and ${folders.length - 3} more` : ''
    notifyWarning(`Couldn't read ${folders.length} folders`, {
        description: `${names}${more} show as empty. Scrivon may not have permission to open them.`,
    })
}

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
    const { settings } = useAppSettings()
    const maxRecentFolders = clampRecentWorkspaceLimit(settings.workspace.maxRecentFolders)
    // A lower limit shows straight away. The saved list is cut to it on the next folder open, so typing
    // '15' into the setting, which passes through '1', can't wipe the list.
    const visibleRecentWorkspaces = useMemo(() => (recentWorkspaces ?? []).slice(0, maxRecentFolders), [recentWorkspaces, maxRecentFolders])

    const workspaceName = workspaceRoot ? getBaseName(workspaceRoot) : null

    const workspaceRootRef = useRef(workspaceRoot)
    useEffect(() => {
        workspaceRootRef.current = workspaceRoot
    }, [workspaceRoot])

    const openWorkspaceRef = useRef<(path: string) => Promise<void>>(async () => {})

    useEffect(() => {
        void getRecentWorkspaces()
            .then(setRecentWorkspaces)
            .catch(() => setRecentWorkspaces([]))
    }, [])

    // After a crash or a forced restart, says which folder has unsaved changes waiting and offers to open it.
    useEffect(() => {
        if (!isDesktop) return
        let cancelled = false
        void listBackupsSafely().then((backups) => {
            if (cancelled || backups.length === 0 || workspaceRootRef.current) return
            const folderOf = (b: UnsavedBackup) => b.root ?? getParentPath(b.path)
            const root = folderOf(backups[0]!)
            const here = backups.filter((b) => samePath(folderOf(b), root))
            const what = here.length === 1 ? `your changes to ${getBaseName(here[0]!.path)}` : `your changes to ${here.length} files`
            const elsewhere = here.length < backups.length ? ' Changes in other folders come back when you open them.' : ''
            notifyWarning('Unsaved changes from last time', {
                id: RECOVERED_CHANGES_NOTICE_ID,
                description: `Scrivon closed before ${what} in ${getBaseName(root) || root} were saved. Open the folder to get them back.${elsewhere}`,
                timeout: 0,
                action: { label: 'Open Folder', onClick: () => void openWorkspaceRef.current(root) },
            })
        })
        return () => {
            cancelled = true
        }
    }, [isDesktop])

    /** Re-reads the folder. A failure is reported rather than thrown, so the action that changed the disk still finishes. */
    // Reads of the tree can overlap (an action and a window focus), so only the one started last is shown.
    const treeRead = useRef(0)

    const refreshTree = useCallback(async () => {
        if (!workspaceRoot) return
        const read = ++treeRead.current
        try {
            const next = await listWorkspaceTree(workspaceRoot)
            if (read === treeRead.current) setTree(next)
        } catch (err) {
            notifyError("Couldn't refresh the file list", err)
        }
    }, [workspaceRoot])

    // Files added, removed or renamed by other apps (File Explorer, git, sync tools) show up when the user comes
    // back to the window. A failed read is left quiet here; the next action that changes the disk reports it.
    useEffect(() => {
        if (!isDesktop || !workspaceRoot) return
        const root = workspaceRoot
        let disposed = false
        let unlisten: (() => void) | undefined
        let reloading = false
        const reload = async () => {
            // Switching windows quickly mustn't start a new read of a big folder each time.
            if (reloading) return
            reloading = true
            const read = ++treeRead.current
            try {
                const next = await listWorkspaceTree(root)
                if (!disposed && read === treeRead.current) setTree(next)
            } catch {
                // See above.
            } finally {
                reloading = false
            }
        }
        try {
            void getCurrentWindow()
                .onFocusChanged(({ payload: focused }) => {
                    if (focused) void reload()
                })
                .then((fn) => {
                    // The effect may have been cleaned up while the listener was still being added.
                    if (disposed) fn()
                    else unlisten = fn
                })
                .catch(() => undefined)
        } catch {
            // No window to listen to (not running in the desktop app).
        }
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [isDesktop, workspaceRoot])

    const removeRecent = useCallback(async (path: string) => {
        try {
            setRecentWorkspaces(await removeRecentWorkspace(path))
        } catch (err) {
            notifyError("Couldn't update recent folders", err)
        }
    }, [])

    /**
     * Reopens the tabs saved for this folder. Files that can't be read any more are skipped, unless they
     * have unsaved text kept from when Scrivon last closed: that text is always brought back, unsaved.
     * Nothing is shown if `isCurrent` says another folder was opened in the meantime.
     */
    const restoreTabSession = useCallback(
        async (path: string, isCurrent: () => boolean) => {
            const tabSession = await getWorkspaceTabSession(path)
            const backups = (await listBackupsSafely()).filter((b) => isPathInside(b.path, path))
            // Older sessions can hold the same file twice with different separators.
            const paths: string[] = []
            for (const id of [...(tabSession?.tabIds ?? []), ...backups.map((b) => b.path)]) {
                const normalized = normalizePath(id)
                if (!paths.some((p) => samePath(p, normalized))) paths.push(normalized)
            }
            if (paths.length === 0) return

            const recovered: string[] = []
            const restoredTabs = (
                await Promise.all(
                    paths.map(async (filePath) => {
                        let tab: DocumentTab | null
                        try {
                            tab = tabFromFile(filePath, await readWorkspaceTextFile(filePath))
                        } catch {
                            tab = null
                        }
                        const backup = backups.find((b) => samePath(b.path, filePath))
                        if (!backup) return tab
                        if (tab && tab.content === backup.content) {
                            // Already on disk: the copy was kept by mistake (its removal failed).
                            void deleteUnsavedBackup(backup.path).catch(() => undefined)
                            return tab
                        }
                        const recoveredTab = tabWithRecoveredText(tab, backup)
                        recovered.push(recoveredTab.name)
                        return recoveredTab
                    })
                )
            ).filter((tab): tab is NonNullable<typeof tab> => tab !== null)

            if (!isCurrent()) return
            if (restoredTabs.length > 0) {
                const savedActiveId = tabSession?.activeTabId
                const activeTab = savedActiveId ? restoredTabs.find((t) => samePath(t.path, savedActiveId)) : undefined
                const activeId = activeTab?.id ?? restoredTabs[0].id
                coordinator.setTabsFromWorkspace.current(restoredTabs, activeId)
                coordinator.requestCanvasFit.current()
            }
            if (recovered.length > 0) {
                const what = recovered.length === 1 ? `your changes to ${recovered[0]}` : `your changes to ${recovered.length} files`
                notifyWarning('Recovered unsaved changes', {
                    id: RECOVERED_CHANGES_NOTICE_ID,
                    description: `Scrivon closed before ${what} were saved. They're open again, but not saved yet.`,
                    timeout: 0,
                })
            }
        },
        [coordinator]
    )

    // Every open or close of a folder gets the next number. An open that a newer one has replaced (the user
    // clicked another folder while a big one was still being read) stops where it is and changes nothing.
    const workspaceRequest = useRef(0)
    const [openingWorkspace, setOpeningWorkspace] = useState<string | null>(null)

    const openWorkspace = useCallback(
        async (requestedPath: string) => {
            if (!isDesktop) return

            const path = normalizePath(requestedPath)
            const openRoot = workspaceRootRef.current
            if (openRoot && samePath(path, openRoot)) {
                // The folder that is already open (it tops Open Recent): its tabs, unsaved edits and undo history
                // stay as they are. A folder still being opened is dropped, so the one clicked last wins.
                workspaceRequest.current += 1
                setOpeningWorkspace(null)
                dismissNotification(OPENING_NOTICE_ID)
                // Saved under the open folder's own spelling, which its saved tabs are kept under.
                void addRecentWorkspace(openRoot, maxRecentFolders)
                    .then(setRecentWorkspaces)
                    .catch((err: unknown) => console.warn("Couldn't update recent folders", err))
                await refreshTree()
                return
            }
            const request = ++workspaceRequest.current
            const isCurrent = () => request === workspaceRequest.current
            const name = getBaseName(path) || path
            setOpeningWorkspace(path)
            // Reading a big folder takes a while; saying so stops the user thinking nothing happened.
            const slowNotice = setTimeout(() => {
                if (isCurrent()) notifyInfo(`Opening ${name}…`, { id: OPENING_NOTICE_ID, description: 'Reading the list of files.', timeout: 0 })
            }, OPENING_NOTICE_DELAY_MS)

            try {
                let nextTree: FileNode[]
                try {
                    await allowWorkspacePath(path)
                    nextTree = await listWorkspaceTree(path)
                    if (!isCurrent()) return
                    // Leaving the open folder closes its tabs, so unsaved or unsavable edits are dealt with first. That
                    // happens only now, right before switching, so nothing typed while the new folder was read is lost.
                    if (workspaceRootRef.current && !(await coordinator.confirmCloseTabs.current())) return
                    if (!isCurrent()) return
                } catch (err) {
                    if (!isCurrent()) return
                    // Nothing has switched yet, so the folder that was open (if any) stays open.
                    // A recent folder that was moved, deleted or is on a missing drive can be dropped from the list.
                    const isRecent = (recentWorkspaces ?? []).some((p) => samePath(p, path))
                    const removeFromRecent = () => void removeRecent(path)
                    notifyError(`Couldn't open ${name}`, err, isRecent ? { action: { label: 'Remove from Recent', onClick: removeFromRecent } } : {})
                    return
                }

                // The old folder's tabs are noted before they are cleared; saving that list is best-effort.
                const leaving = workspaceRootRef.current ? coordinator.persistWorkspaceTabSession.current() : null
                workspaceRootRef.current = path
                setWorkspaceRoot(path)
                treeRead.current += 1
                setTree(nextTree)
                coordinator.clearTabs.current()
                warnAboutUnreadableFolders(nextTree)
                void leaving?.catch((err: unknown) => console.warn("Couldn't remember the tabs of the folder that was open", err))
                void addRecentWorkspace(path, maxRecentFolders)
                    .then((recents) => {
                        if (isCurrent()) setRecentWorkspaces(recents)
                    })
                    .catch((err: unknown) => console.warn("Couldn't update recent folders", err))

                try {
                    await restoreTabSession(path, isCurrent)
                } catch (err) {
                    if (isCurrent()) notifyError("Couldn't reopen the files you had open", err)
                }
            } finally {
                clearTimeout(slowNotice)
                if (isCurrent()) {
                    setOpeningWorkspace(null)
                    dismissNotification(OPENING_NOTICE_ID)
                }
            }
        },
        [isDesktop, recentWorkspaces, maxRecentFolders, removeRecent, restoreTabSession, refreshTree, coordinator]
    )

    useEffect(() => {
        openWorkspaceRef.current = openWorkspace
    }, [openWorkspace])

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
        // Closing is the newest request: a folder still being opened, or a file list still being read, is dropped.
        workspaceRequest.current += 1
        treeRead.current += 1
        setOpeningWorkspace(null)
        dismissNotification(OPENING_NOTICE_ID)
        const leaving = coordinator.persistWorkspaceTabSession.current()
        workspaceRootRef.current = null
        setWorkspaceRoot(null)
        setTree([])
        coordinator.clearTabs.current()
        await leaving.catch((err: unknown) => console.warn("Couldn't remember the tabs of the folder that was open", err))
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
            // The new file opens straight away; in a big folder, reading the file list again takes a while.
            await Promise.all([refreshTree(), coordinator.openFile.current(path)])
        },
        [getNameError, refreshTree, coordinator]
    )

    /** A folder the file list leaves out (a tool or build folder) seems to vanish once made, so the user is told why. */
    const explainIfHidden = useCallback(
        (parentPath: string, name: string) => {
            const siblings = childrenOf(tree, workspaceRoot, parentPath).map((node) => node.name)
            if (!isHiddenFolder(name, siblings)) return
            notifyInfo(`${name} is hidden`, { description: 'Scrivon leaves tool and build folders like this one out of the file list.' })
        },
        [tree, workspaceRoot]
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
            explainIfHidden(parentPath, name)
            await refreshTree()
        },
        [getNameError, refreshTree, explainIfHidden]
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
            // Saves of the files being renamed wait until their tabs have moved too, so none writes to the old
            // path (bringing the old file back next to the new one) and none is dropped.
            const release = await coordinator.holdSaves.current(oldPath, isDirectory)
            let whereNow = (id: string): string | null => id
            try {
                await renameWorkspacePath(oldPath, newPath)
                // The tabs follow straight away; reading the file list again can take a while.
                coordinator.remapTabsAfterRename.current(oldPath, newPath, newName)
                whereNow = (id) => remapPathAfterRename(id, oldPath, newPath)
                if (isDirectory) explainIfHidden(parent, newName)
            } catch (err) {
                notifyError(failed, err)
            } finally {
                release(whereNow)
            }
            await refreshTree()
        },
        [getNameError, refreshTree, explainIfHidden, coordinator]
    )

    const deleteEntry = useCallback(
        async (path: string, isDirectory: boolean) => {
            // A save due for a file being deleted must not write it back, so saves wait until its tabs are closed.
            const release = await coordinator.holdSaves.current(path, isDirectory)
            let whereNow = (id: string): string | null => id
            try {
                // The user confirmed deleting the folder and everything in it; without recursive a folder that isn't empty is refused.
                await removeWorkspacePath(path, { recursive: isDirectory })
                coordinator.closeTabsForDelete.current(path, isDirectory)
                whereNow = () => null
            } catch (err) {
                // Its tabs stay open: the file (or some of the folder) may still be there.
                notifyError(`Couldn't delete ${getBaseName(path)}`, err)
            } finally {
                release(whereNow)
            }
            await refreshTree()
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
            await Promise.all([refreshTree(), coordinator.openFile.current(destPath)])
        },
        [refreshTree, coordinator]
    )

    const value = useMemo(
        () => ({
            isDesktop,
            hydrated,
            workspaceRoot,
            workspaceName,
            openingWorkspace,
            tree,
            recentWorkspaces: visibleRecentWorkspaces,
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
            openingWorkspace,
            tree,
            visibleRecentWorkspaces,
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
