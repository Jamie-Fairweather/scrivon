'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { defaultMarkdownFor } from '@/lib/default-markdown'
import { confirmDeleteHiddenFolders, confirmKeptChangesWithoutFolder, confirmOpenLargeFile, pickWorkspaceFolder } from '@/lib/tauri/dialog'
import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    findHiddenFolders,
    getBaseName,
    getParentPath,
    getWorkspaceFileSize,
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
    watchWorkspace,
    type WorkspaceChange,
} from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'
import { deleteUnsavedBackup, listUnsavedBackups, settleUnsavedBackups, type UnsavedBackup } from '@/lib/tauri/backups'
import {
    addRecentWorkspace,
    clampRecentWorkspaceLimit,
    getFolderToggles,
    getRecentWorkspaces,
    getWorkspaceTabSession,
    removeRecentWorkspace,
    setFolderToggles,
} from '@/lib/tauri/store'
import { formatFileSize, isLargeFile, tabFromFile, tabWithRecoveredText } from '@/lib/workspace/document-tab'
import { dismissNotification, notifyError, notifyInfo, notifySuccess, notifyWarning } from '@/lib/notify'
import { isMarkdownFile, isSupportedDocument } from '@/lib/workspace/file-types'
import {
    changeAltersTree,
    childrenOf,
    collectUnreadableFolders,
    entryNameError,
    keepUnchangedNodes,
    uniqueFileName,
    uniqueNewName,
} from '@/lib/workspace/paths'
import { dropPathKeysAfterDelete, remapPathAfterRename, remapPathKeysAfterRename } from '@/lib/workspace/tab-paths'
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
    /**
     * The folders the user opened or closed in the file tree, by path; the rest follow the tree's default.
     * Kept here rather than in the tree, so hiding the explorer or switching to Examples doesn't lose them,
     * and remembered for each folder. They follow a rename and are dropped on delete.
     */
    folderToggles: ReadonlyMap<string, boolean>
    /** Opens or closes a folder in the file tree, and remembers the choice. Stays the same function throughout. */
    setFolderExpanded: (path: string, expanded: boolean) => void
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
/** The least time between two reads of the folder when the window gets focus or another app changes it. */
const FOCUS_RELOAD_GAP_MS = 5_000
/** Past this many changed paths waiting to be looked at, the folder is simply read again. */
const MAX_SEEN_CHANGES = 1_000

/** The copies of unsaved text kept from earlier; none when they can't be read (they are only a safety net). */
async function listBackupsSafely(): Promise<UnsavedBackup[]> {
    try {
        return await listUnsavedBackups()
    } catch (err) {
        console.warn("Couldn't read the copies of unsaved changes", err)
        return []
    }
}

/**
 * Tells the user which folders show up empty because they couldn't be read (the rest of the folder still
 * opens), and why: no permission, or a link to a folder outside the opened one, which Scrivon can't open yet.
 */
function warnAboutUnreadableFolders(tree: FileNode[]) {
    const folders = collectUnreadableFolders(tree)
    if (folders.length === 0) return
    const links = folders.filter((f) => f.kind === 'directory' && f.linksOutside).length
    if (folders.length === 1) {
        notifyWarning(links ? `Couldn't open the linked folder ${folders[0]!.name}` : `Couldn't read the folder ${folders[0]!.name}`, {
            description: links
                ? "It shows as empty. It links to a folder outside the one you opened, which Scrivon can't open yet."
                : 'It shows as empty. Scrivon may not have permission to open it.',
        })
        return
    }
    const names = folders
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')
    const more = folders.length > 3 ? ` and ${folders.length - 3} more` : ''
    const why =
        links === folders.length
            ? "They link to folders outside the one you opened, which Scrivon can't open yet."
            : links > 0
              ? "Scrivon may not have permission to open them, or they link to folders outside the one you opened, which it can't open yet."
              : 'Scrivon may not have permission to open them.'
    notifyWarning(`Couldn't read ${folders.length} folders`, { description: `${names}${more} show as empty. ${why}` })
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

    const [folderToggles, setFolderTogglesState] = useState<ReadonlyMap<string, boolean>>(() => new Map())
    // The ref is the latest value, so changes made one after another (a rename, then a click) build on each other.
    const folderTogglesRef = useRef(folderToggles)

    /** Changes which folders are open; with `root`, also remembers them for that folder (best-effort). */
    const updateFolderToggles = useCallback((root: string | null, update: (prev: ReadonlyMap<string, boolean>) => ReadonlyMap<string, boolean>) => {
        const next = update(folderTogglesRef.current)
        if (next === folderTogglesRef.current) return
        folderTogglesRef.current = next
        setFolderTogglesState(next)
        if (root) void setFolderToggles(root, next).catch((err: unknown) => console.warn("Couldn't remember which folders are open", err))
    }, [])

    const setFolderExpanded = useCallback(
        (path: string, expanded: boolean) => {
            const key = normalizePath(path)
            updateFolderToggles(workspaceRootRef.current, (prev) => {
                if (prev.get(key) === expanded) return prev
                const next = new Map(prev)
                // The latest choice goes last, so the newest are the ones kept if the list is ever cut.
                next.delete(key)
                return next.set(key, expanded)
            })
        },
        [updateFolderToggles]
    )

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
            // Parts of the tree that didn't change stay the same objects, so their rows don't draw again.
            if (read === treeRead.current) setTree((prev) => keepUnchangedNodes(prev, next))
        } catch (err) {
            notifyError("Couldn't refresh the file list", err)
        }
    }, [workspaceRoot])

    // The tree shown now, for telling whether a change seen by the watcher alters it.
    const treeRef = useRef(tree)
    useEffect(() => {
        treeRef.current = tree
    }, [tree])

    // Files added, removed or renamed by other apps (File Explorer, git, sync tools) show up, and open files
    // without edits that they changed show the new text: as the watcher sees the change, and again when the
    // user comes back to the window (some drives can't be watched). A failed read is left quiet here; the next
    // action that changes the disk reports it.
    useEffect(() => {
        if (!isDesktop || !workspaceRoot) return
        const root = workspaceRoot
        let disposed = false
        let unlisten: (() => void) | undefined
        let unwatch: (() => void) | undefined
        let reloading = false
        let again = false
        let lastReloadEnd = 0
        let planned: ReturnType<typeof setTimeout> | undefined
        // What the next reload reads: the whole tree after a focus, otherwise only if what the watcher saw alters it.
        let treeWanted = false
        let seen: { added: string[]; removed: string[] } = { added: [], removed: [] }
        const readTree = async () => {
            const read = ++treeRead.current
            try {
                const next = await listWorkspaceTree(root)
                // Nothing changed, nothing redraws: the tree shown now is kept as it is.
                if (!disposed && read === treeRead.current) setTree((prev) => keepUnchangedNodes(prev, next))
            } catch {
                // See above.
            }
        }
        const reloadTabs = async () => {
            try {
                if (!disposed) await coordinator.reloadChangedTabs.current()
            } catch (err) {
                console.warn("Couldn't check the open files for changes", err)
            }
        }
        const reload = async () => {
            reloading = true
            const withTree = treeWanted || changeAltersTree(treeRef.current, root, seen)
            treeWanted = false
            seen = { added: [], removed: [] }
            try {
                await Promise.all([withTree ? readTree() : undefined, reloadTabs()])
            } finally {
                reloading = false
                lastReloadEnd = Date.now()
            }
            // Something changed while that ran: it is read too, once the gap is over.
            if (again && !disposed) {
                again = false
                request()
            }
        }
        // Alt-tabbing back and forth, each native dialog closing, or a sync tool busy in the folder mustn't read a
        // big folder again every time: at most once every few seconds. A focus or change inside that gap is read
        // once the gap is over, so it still shows.
        const request = () => {
            if (reloading) {
                again = true
                return
            }
            if (planned !== undefined) return
            const wait = lastReloadEnd + FOCUS_RELOAD_GAP_MS - Date.now()
            if (wait <= 0) {
                void reload()
                return
            }
            planned = setTimeout(() => {
                planned = undefined
                if (!disposed) void reload()
            }, wait)
        }
        const onFocus = () => {
            treeWanted = true
            request()
        }
        const onDiskChange = (change: WorkspaceChange) => {
            // A whole read is due anyway, so there is no need to keep what changed (a checkout can touch thousands of files).
            if (!treeWanted) {
                seen.added.push(...change.added)
                seen.removed.push(...change.removed)
                if (seen.added.length + seen.removed.length > MAX_SEEN_CHANGES) treeWanted = true
            }
            request()
        }
        // Where the folder can't be watched (some network drives), coming back to the window still reads it.
        void watchWorkspace(root, onDiskChange)
            .then((fn) => {
                if (disposed) fn()
                else unwatch = fn
            })
            .catch((err: unknown) => console.warn(`Can't watch ${root} for changes`, err))
        try {
            void getCurrentWindow()
                .onFocusChanged(({ payload: focused }) => {
                    if (focused) onFocus()
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
            clearTimeout(planned)
            unlisten?.()
            unwatch?.()
        }
    }, [isDesktop, workspaceRoot, coordinator])

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

            // A very large file can make the app stop responding for a while, so, as when it was first opened,
            // the user decides before it is read again (one question at a time). Kept unsaved text always comes back.
            const hasBackup = (filePath: string) => backups.some((b) => samePath(b.path, filePath))
            const sizes = await Promise.all(paths.map((filePath) => (hasBackup(filePath) ? null : getWorkspaceFileSize(filePath))))
            const skipped = new Set<string>()
            for (const [i, filePath] of paths.entries()) {
                const size = sizes[i]
                if (!isLargeFile(size)) continue
                if (!isCurrent()) return
                if (!(await confirmOpenLargeFile(getBaseName(filePath), formatFileSize(size)))) skipped.add(filePath)
            }

            const recovered: string[] = []
            const restoredTabs = (
                await Promise.all(
                    paths
                        .filter((filePath) => !skipped.has(filePath))
                        .map(async (filePath) => {
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

    /**
     * Unsaved changes kept for `root` only come back when that folder opens. When it can't (moved, renamed or
     * deleted elsewhere), the user picks what happens to them, so the "from last time" notice can't come back
     * on every launch with no way out: save them as new files in another folder, discard them, or keep them.
     */
    const offerKeptChanges = useCallback(async (root: string) => {
        const kept = (await listBackupsSafely()).filter((b) => samePath(b.root ?? getParentPath(b.path), root))
        if (kept.length === 0) return
        const choice = await confirmKeptChangesWithoutFolder(
            getBaseName(root) || root,
            kept.map((b) => getBaseName(b.path))
        )
        if (choice === 'keep') return
        if (choice === 'save') {
            const failed = "Couldn't save the copies"
            let folder: string | null
            try {
                folder = await pickWorkspaceFolder('Save Copies To')
            } catch (err) {
                notifyError(failed, err)
                return
            }
            if (!folder) return
            try {
                const names = await listFolderNames(folder)
                for (const backup of kept) {
                    const name = uniqueNewName(getBaseName(backup.path), names)
                    names.push(name)
                    await createWorkspaceFile(joinPath(folder, name), backup.content, backup.format)
                }
            } catch (err) {
                // The copies stay kept, so nothing is lost; the user can try again.
                notifyError(failed, err)
                return
            }
            notifySuccess(kept.length === 1 ? `Saved ${getBaseName(kept[0]!.path)}` : `Saved ${kept.length} files`, {
                description: `They're in ${getBaseName(folder) || folder}.`,
            })
        }
        dismissNotification(RECOVERED_CHANGES_NOTICE_ID)
        await Promise.all(kept.map((b) => deleteUnsavedBackup(b.path).catch((err: unknown) => console.warn("Couldn't remove a kept copy", err))))
    }, [])

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
                    // A folder picked while this is still being answered (or saved) gets the same answer, and the
                    // tabs are only let go once a switch really happens (clearTabs).
                    if (workspaceRootRef.current && !(await coordinator.confirmCloseTabs.current())) return
                    if (!isCurrent()) return
                } catch (err) {
                    if (!isCurrent()) return
                    // Nothing has switched yet, so the folder that was open (if any) stays open.
                    // A recent folder that was moved, deleted or is on a missing drive can be dropped from the list.
                    const isRecent = (recentWorkspaces ?? []).some((p) => samePath(p, path))
                    const removeFromRecent = () => void removeRecent(path)
                    notifyError(`Couldn't open ${name}`, err, isRecent ? { action: { label: 'Remove from Recent', onClick: removeFromRecent } } : {})
                    void offerKeptChanges(path)
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
                // The new folder's tree opens folders as it had them last time.
                updateFolderToggles(null, () => new Map())
                void getFolderToggles(path)
                    .then((stored) => {
                        if (!isCurrent() || stored.length === 0) return
                        // A folder opened or closed while these were read keeps that newer choice, and the
                        // merged list is saved again, since that click saved only its own part.
                        updateFolderToggles(folderTogglesRef.current.size > 0 ? path : null, (prev) => new Map([...stored, ...prev]))
                    })
                    .catch((err: unknown) => console.warn("Couldn't read which folders were open", err))
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
        [
            isDesktop,
            recentWorkspaces,
            maxRecentFolders,
            removeRecent,
            restoreTabSession,
            offerKeptChanges,
            refreshTree,
            updateFolderToggles,
            coordinator,
        ]
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
        // Already remembered for the folder as each was opened or closed.
        updateFolderToggles(null, () => new Map())
        coordinator.clearTabs.current()
        // With no folder open, closing the window doesn't wait for anything, so the copies of the closed tabs'
        // unsaved text are removed from disk now; otherwise they could be offered back on the next launch.
        await Promise.all([
            leaving.catch((err: unknown) => console.warn("Couldn't remember the tabs of the folder that was open", err)),
            settleUnsavedBackups(),
        ])
    }, [coordinator, updateFolderToggles])

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
            const resolvedContent = content ?? (isMarkdownFile(name) ? defaultMarkdownFor(name) : DEFAULT_DIAGRAM)
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
                if (isDirectory) {
                    // The folder and the ones inside it stay open or closed as they were.
                    updateFolderToggles(workspaceRootRef.current, (prev) => remapPathKeysAfterRename(prev, oldPath, newPath))
                    explainIfHidden(parent, newName)
                }
            } catch (err) {
                notifyError(failed, err)
            } finally {
                release(whereNow)
            }
            await refreshTree()
        },
        [getNameError, refreshTree, explainIfHidden, updateFolderToggles, coordinator]
    )

    const deleteEntry = useCallback(
        async (path: string, isDirectory: boolean) => {
            if (isDirectory) {
                // Deleting a folder takes everything in it, including folders the file list leaves out (a git
                // repository, say), which the user agreed to without seeing them; so those are named first.
                const hidden = await findHiddenFolders(path)
                if (hidden.length > 0 && !(await confirmDeleteHiddenFolders(getBaseName(path), hidden))) return
            }
            // A save due for a file being deleted must not write it back, so saves wait until its tabs are closed.
            const release = await coordinator.holdSaves.current(path, isDirectory)
            let whereNow = (id: string): string | null => id
            try {
                // The user confirmed deleting the folder and everything in it; without recursive a folder that isn't empty is refused.
                await removeWorkspacePath(path, { recursive: isDirectory })
                coordinator.closeTabsForDelete.current(path, isDirectory)
                whereNow = () => null
                // A new folder made later with the same name starts as any other.
                if (isDirectory) updateFolderToggles(workspaceRootRef.current, (prev) => dropPathKeysAfterDelete(prev, path))
            } catch (err) {
                // Its tabs stay open: the file (or some of the folder) may still be there.
                notifyError(`Couldn't delete ${getBaseName(path)}`, err)
            } finally {
                release(whereNow)
            }
            await refreshTree()
        },
        [refreshTree, updateFolderToggles, coordinator]
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
            // A copy of a file Scrivon doesn't open (an image, say) just shows up in the list.
            await Promise.all([refreshTree(), isSupportedDocument(destPath) ? coordinator.openFile.current(destPath) : null])
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
            folderToggles,
            setFolderExpanded,
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
            folderToggles,
            setFolderExpanded,
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
