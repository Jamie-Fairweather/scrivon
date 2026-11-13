'use client'

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type ReactNode,
    type SetStateAction,
} from 'react'
import { APP_EXAMPLE_BY_ID } from '@/lib/examples/app-samples'
import { exampleTabId, isExampleTabId, tabFromExample } from '@/lib/examples/example-tab'
import { dismissNotification, notifyError, notifyWarning } from '@/lib/notify'
import { settleUnsavedBackups } from '@/lib/tauri/backups'
import { confirmCloseAfterSaveFailure, confirmOpenLargeFile, confirmUnsavedChanges, showError } from '@/lib/tauri/dialog'
import {
    getBaseName,
    getWorkspaceFileSize,
    isFileMissingError,
    isPathInside,
    isSupportedDocument,
    normalizePath,
    readStamp,
    readWorkspaceTextFile,
    samePath,
    stampChanged,
} from '@/lib/tauri/fs'
import { setWorkspaceTabSession, addRecentFile, removeRecentFiles } from '@/lib/tauri/store'
import { formatFileSize, isLargeFile, tabFromFile } from '@/lib/workspace/document-tab'
import { supportedExtensionsLabel } from '@/lib/workspace/file-types'
import { DEFAULT_TEXT_FORMAT } from '@/lib/workspace/text-encoding'
import { remapPathAfterRename, remapTabsAfterRename, tabsToCloseOnDelete } from '@/lib/workspace/tab-paths'
import type { DocumentTab } from '@/lib/workspace/types'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type DocumentTabsContextValue = {
    tabs: DocumentTab[]
    activeTabId: string | null
    activeTab: DocumentTab | null
    openFile: (path: string) => Promise<void>
    openExample: (exampleId: string) => void
    setActiveTab: (id: string) => Promise<void>
    updateTabContent: (id: string, content: string) => void
    closeTab: (id: string) => Promise<void>
    closeOtherTabs: (keepId: string) => Promise<void>
    closeAllTabs: () => Promise<void>
    /**
     * Lets the user edit a tab that opened read-only for a reason they may accept: a file that isn't UTF-8
     * (saved as UTF-8 from then on) or a very large one. Does nothing for a file that looks binary.
     */
    makeTabEditable: (id: string) => void
}

/** What can be done with the tabs. These functions stay the same while the user types. */
export type DocumentTabActions = Pick<
    DocumentTabsContextValue,
    'openFile' | 'openExample' | 'setActiveTab' | 'updateTabContent' | 'closeTab' | 'closeOtherTabs' | 'closeAllTabs' | 'makeTabEditable'
>

/** Why a tab opened read-only, and the label of the button that lets the user edit it anyway, if there is one. */
export type ReadOnlyReason = { text: string; editLabel: string | null }

/**
 * Why a file opened read-only: its bytes couldn't be read safely as text, and editing could damage them, or
 * it is so big that editing it would be slow. Null for a tab that isn't read-only for either reason.
 */
export function readOnlyReason(tab: DocumentTab): ReadOnlyReason | null {
    if (tab.encodingIssue === 'legacy-encoding') {
        return {
            text: "It isn't saved as UTF-8, so it's shown as Windows-1252 and left as it is. If you edit it, it will be saved as UTF-8.",
            editLabel: 'Edit as UTF-8',
        }
    }
    if (tab.encodingIssue) {
        return { text: "It looks like a binary file or uses a text encoding Scrivon can't read, so it's left as it is.", editLabel: null }
    }
    if (tab.largeFile) {
        // From when it was read: a read-only tab is never saved, so this doesn't change under it.
        const size = tab.disk?.stamp?.size
        return { text: `It's ${size ? formatFileSize(size) : 'very large'}, which is big enough to make editing slow.`, editLabel: 'Edit Anyway' }
    }
    return null
}

/** The tab once the user chose to edit it anyway. */
function withEditingAllowed(t: DocumentTab): DocumentTab {
    if (t.encodingIssue === 'legacy-encoding') {
        return { ...t, readOnly: false, encodingIssue: undefined, largeFile: undefined, format: DEFAULT_TEXT_FORMAT }
    }
    if (t.largeFile && !t.encodingIssue) return { ...t, readOnly: false, largeFile: undefined }
    return t
}

const DocumentTabsContext = createContext<DocumentTabsContextValue | null>(null)
const DocumentTabActionsContext = createContext<DocumentTabActions | null>(null)
/** `undefined` only outside the provider; no tab open is `null`. */
const ActiveTabIdContext = createContext<string | null | undefined>(undefined)

/** How long closing waits for a save before asking the user (e.g. an offline network drive). */
const SAVE_BEFORE_CLOSE_TIMEOUT_MS = 10_000

/** Rounds of saving closing tabs again for text typed meanwhile, before asking the user. */
const MAX_SAVE_ROUNDS_BEFORE_CLOSE = 3
const EDITED_WHILE_SAVING = 'It was edited again while it was being saved.'

/** Time spent waiting for the user to answer a question during the save doesn't count. */
function saveWithin(save: Promise<boolean>, ms: number, isAskingUser: () => boolean): Promise<boolean | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
        const check = () => {
            if (isAskingUser()) timer = setTimeout(check, ms)
            else resolve('timeout')
        }
        timer = setTimeout(check, ms)
    })
    return Promise.race([save, timeout]).finally(() => clearTimeout(timer))
}

function readOnlyNoticeId(tabId: string): string {
    return `read-only:${tabId}`
}

/** Every tab with its text. Whatever uses this draws again on every keystroke; see the two hooks below. */
export function useDocumentTabs(): DocumentTabsContextValue {
    const ctx = useContext(DocumentTabsContext)
    if (!ctx) throw new Error('useDocumentTabs must be used within WorkspaceProvider')
    return ctx
}

/** Opening, switching and closing tabs, without the tabs themselves, so typing doesn't draw the caller again. */
export function useDocumentTabActions(): DocumentTabActions {
    const ctx = useContext(DocumentTabActionsContext)
    if (!ctx) throw new Error('useDocumentTabActions must be used within WorkspaceProvider')
    return ctx
}

/** The id of the tab on screen, or null. Changes when another tab is chosen, not when the user types. */
export function useActiveTabId(): string | null {
    const id = useContext(ActiveTabIdContext)
    if (id === undefined) throw new Error('useActiveTabId must be used within WorkspaceProvider')
    return id
}

export type DocumentTabsState = {
    tabs: DocumentTab[]
    setTabs: Dispatch<SetStateAction<DocumentTab[]>>
    activeTabId: string | null
    setActiveTabId: Dispatch<SetStateAction<string | null>>
    tabsRef: MutableRefObject<DocumentTab[]>
}

type DocumentTabsProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
    workspaceRoot: string | null
    tabsState: DocumentTabsState
}

export function DocumentTabsProvider({ children, coordinator, workspaceRoot, tabsState }: DocumentTabsProviderProps) {
    const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef } = tabsState
    const activeTabIdRef = useRef(activeTabId)

    useEffect(() => {
        activeTabIdRef.current = activeTabId
    }, [activeTabId])

    const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId])

    const persistTabSession = useCallback(
        async (snapshot?: { tabs: DocumentTab[]; activeTabId: string | null }) => {
            if (!workspaceRoot) return
            const sourceTabs = snapshot?.tabs ?? tabsRef.current
            const workspaceTabs = sourceTabs.filter((t) => !isExampleTabId(t.id))
            const activeId = snapshot?.activeTabId ?? activeTabIdRef.current
            const resolvedActiveId =
                activeId && !isExampleTabId(activeId) && workspaceTabs.some((t) => t.id === activeId) ? activeId : (workspaceTabs[0]?.id ?? null)
            // Remembering the open tabs is a convenience: a failure (reported by the store) never stops what the user did.
            try {
                await setWorkspaceTabSession(workspaceRoot, {
                    // One entry per file, even if a tab was ever doubled up, so a double never comes back on restart.
                    tabIds: [...new Set(workspaceTabs.map((t) => t.id))],
                    activeTabId: resolvedActiveId,
                })
            } catch (err) {
                console.warn("Couldn't remember the open tabs", err)
            }
        },
        [workspaceRoot, tabsRef]
    )

    /** Adds a file to the folder's recent files for the palette; best-effort, like the tab session. */
    const recordRecentFile = useCallback(
        (path: string) => {
            if (!workspaceRoot) return
            void addRecentFile(workspaceRoot, path).catch((err: unknown) => console.warn("Couldn't update recent files", err))
        },
        [workspaceRoot]
    )

    /** Drops a file that turned out not to be there from the folder's recent files; best-effort too. */
    const forgetRecentFile = useCallback(
        (path: string) => {
            if (!workspaceRoot) return
            void removeRecentFiles(workspaceRoot, path).catch((err: unknown) => console.warn("Couldn't update recent files", err))
        },
        [workspaceRoot]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { persistWorkspaceTabSession: persistTabSession })
    }, [coordinator, persistTabSession])

    const makeTabEditable = useCallback(
        (id: string) => {
            dismissNotification(readOnlyNoticeId(id))
            const allow = (t: DocumentTab) => (t.id === id ? withEditingAllowed(t) : t)
            // The ref too, so typing straight away isn't turned away as read-only.
            tabsRef.current = tabsRef.current.map(allow)
            setTabs((prev) => prev.map(allow))
        },
        [setTabs, tabsRef]
    )

    /** Says why a file opened read-only. The bar above the editor says it too, for as long as the tab is open. */
    const explainReadOnlyFile = useCallback(
        (tab: DocumentTab) => {
            const reason = readOnlyReason(tab)
            if (!reason) return
            notifyWarning(`${tab.name} is read-only`, {
                id: readOnlyNoticeId(tab.id),
                description: reason.text,
                timeout: 0,
                ...(reason.editLabel ? { action: { label: reason.editLabel, onClick: () => makeTabEditable(tab.id) } } : {}),
            })
        },
        [makeTabEditable]
    )

    /**
     * Puts the file as it is on disk now in the tab, unedited. With `onlyIfUntouched`, the tab is left as it
     * is when the user typed in it or saved it while the file was being read, so a reload nobody asked for
     * can never drop typing. Without it the user chose to drop their edits, so their pending save, their
     * copy and their "couldn't save" notice go too. Resolves false when the tab was left as it is.
     */
    const reloadTab = useCallback(
        async (id: string, onlyIfUntouched: boolean): Promise<boolean> => {
            const before = tabsRef.current.find((t) => t.id === id)
            if (!before) return false
            const fresh = tabFromFile(before.path, await readWorkspaceTextFile(before.path))
            const now = tabsRef.current.find((t) => t.id === id)
            if (!now) return false
            if (onlyIfUntouched && (now.isDirty || now.content !== before.content || now.disk?.stamp !== before.disk?.stamp)) return false
            if (!onlyIfUntouched) coordinator.cancelScheduledSave.current(id)
            const reloaded = (t: DocumentTab): DocumentTab =>
                t.id === id
                    ? {
                          ...t,
                          content: fresh.content,
                          format: fresh.format,
                          readOnly: fresh.readOnly,
                          encodingIssue: fresh.encodingIssue,
                          largeFile: fresh.largeFile,
                          disk: fresh.disk,
                          isDirty: false,
                          isSaving: false,
                          saveError: undefined,
                      }
                    : t
            // The ref and the editor change straight away, so a save, a restore or a key pressed before React
            // re-renders sees the new text (and the disk version it goes with).
            tabsRef.current = tabsRef.current.map(reloaded)
            coordinator.replaceEditorText.current(id, fresh.content)
            setTabs((prev) => prev.map(reloaded))
            dismissNotification(readOnlyNoticeId(id))
            // The other app may have saved it in a way Scrivon opens read-only (not UTF-8, say).
            const tab = tabsRef.current.find((t) => t.id === id)
            if (tab?.readOnly) explainReadOnlyFile(tab)
            return true
        },
        [coordinator, explainReadOnlyFile, setTabs, tabsRef]
    )

    /**
     * For tabs that are really closing, once their edits were saved or the user chose not to keep them: drops
     * their pending autosave, their copy of unsaved text and their notices. Never done before the close is
     * sure, so a folder switch that ends up not happening leaves the tabs exactly as they were.
     */
    const releaseTabs = useCallback(
        (closing: readonly DocumentTab[]) => {
            for (const tab of closing) {
                coordinator.cancelScheduledSave.current(tab.id)
                dismissNotification(readOnlyNoticeId(tab.id))
            }
        },
        [coordinator]
    )

    // Files still being read, so a double-click (or another click while a slow file loads) reuses the first open.
    const pendingOpens = useRef(new Map<string, Promise<void>>())
    // The file or tab the user asked for last: an open that finishes after it doesn't take the focus away.
    const lastRequestedRef = useRef<string | null>(null)

    // Goes up whenever every tab goes (a folder switch or close): a file still being read for the folder that
    // was open then doesn't open in the next one, or save its tab list under the old folder.
    const tabsGeneration = useRef(0)

    useEffect(() => {
        registerCoordinatorRefs(coordinator, {
            releaseAllTabs: async () => {
                releaseTabs(tabsRef.current)
                // The copies are gone from disk before the window closes, so text that was saved, or that the
                // user chose not to save, isn't offered back on the next launch.
                await settleUnsavedBackups()
            },
            backUpUnsavedTabs: () => {
                for (const tab of tabsRef.current) {
                    if (tab.isDirty && !tab.readOnly) coordinator.scheduleBackup.current(tab.id)
                }
            },
            remapTabsAfterRename: (oldPath, newPath, newName) => {
                const prevTabs = tabsRef.current
                const nextTabs = remapTabsAfterRename(prevTabs, oldPath, newPath, newName)
                const prevActiveId = activeTabIdRef.current
                const nextActiveId = prevActiveId ? remapPathAfterRename(prevActiveId, oldPath, newPath) : null
                // The refs change straight away and the state with an update, so a change queued for another tab is kept.
                tabsRef.current = nextTabs
                setTabs((prev) => remapTabsAfterRename(prev, oldPath, newPath, newName))
                if (nextActiveId !== prevActiveId) {
                    activeTabIdRef.current = nextActiveId
                    setActiveTabId(nextActiveId)
                }
                coordinator.tabsMoved.current(
                    prevTabs.flatMap((t, i) => (t.isDirty && t.id !== nextTabs[i]!.id ? [{ from: t.id, to: nextTabs[i]!.id }] : []))
                )
                // A read-only notice's button is tied to the old path, so it would find no tab. It isn't shown again
                // (the user may have closed it); the bar above the editor still says why and offers the same button.
                prevTabs.forEach((t, i) => {
                    if (t.id !== nextTabs[i]!.id && readOnlyReason(t)) dismissNotification(readOnlyNoticeId(t.id))
                })
                void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
            },
            closeTabsForDelete: (path, isDirectory) => {
                const toClose = tabsToCloseOnDelete(tabsRef.current, path, isDirectory)
                releaseTabs(toClose)
                const closingIds = new Set(toClose.map((t) => t.id))
                const nextTabs = tabsRef.current.filter((t) => !closingIds.has(t.id))
                const closingActive = activeTabIdRef.current !== null && closingIds.has(activeTabIdRef.current)
                const nextActiveId = closingActive ? (nextTabs[0]?.id ?? null) : activeTabIdRef.current
                tabsRef.current = nextTabs
                setTabs((prev) => prev.filter((t) => !closingIds.has(t.id)))
                if (closingActive) {
                    activeTabIdRef.current = nextActiveId
                    setActiveTabId(nextActiveId)
                }
                void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
            },
            findTabsToCloseOnDelete: (path, isDirectory) => tabsToCloseOnDelete(tabsRef.current, path, isDirectory),
            clearTabs: () => {
                releaseTabs(tabsRef.current)
                tabsGeneration.current += 1
                pendingOpens.current.clear()
                lastRequestedRef.current = null
                // The refs change straight away, so anything that runs before React re-renders sees no tabs.
                tabsRef.current = []
                activeTabIdRef.current = null
                setTabs([])
                setActiveTabId(null)
            },
            getUnsavedContent: (path) => {
                const tab = tabsRef.current.find((t) => samePath(t.path, path))
                return tab?.isDirty ? { content: tab.content, format: tab.format } : undefined
            },
            setTabsFromWorkspace: (nextTabs, nextActiveId) => {
                // A file the user opened while the saved tabs were still loading stays open, and stays the one shown.
                const opened = tabsRef.current
                const openTab = (current: readonly DocumentTab[], path: string) => current.find((o) => samePath(o.path, path))
                const notOpen = (current: DocumentTab[]) => nextTabs.filter((t) => !openTab(current, t.path))
                const restored = notOpen(opened)
                // Unsaved text kept from a crash (a restored tab with edits) goes into that open tab instead, as long as
                // the user hasn't changed it: no edits, and still the version of the file that text was written on.
                // A tab typed in and saved since is clean again, but holds newer text (and its save dropped the copy).
                // Otherwise the text is left out for the caller to keep some other way.
                const takesRecovered = (o: DocumentTab, r: DocumentTab) => {
                    const onDisk = o.disk?.stamp
                    const writtenOn = r.disk?.stamp
                    return !o.isDirty && !o.isSaving && !!onDisk && !!writtenOn && !stampChanged(writtenOn, onDisk)
                }
                const recovered = nextTabs.filter((t) => {
                    const o = t.isDirty ? openTab(opened, t.path) : undefined
                    return o !== undefined && o.content !== t.content
                })
                const left = recovered.filter((t) => !takesRecovered(openTab(opened, t.path)!, t))
                const withRecovered = (o: DocumentTab): DocumentTab => {
                    const r = recovered.find((t) => samePath(t.path, o.path) && !left.includes(t))
                    if (!r || !takesRecovered(o, r)) return o
                    const merged: DocumentTab = { ...o, content: r.content, format: r.format, disk: r.disk, isDirty: true }
                    // As tabWithRecoveredText: it was being edited, so a read-only reason from the file now doesn't apply.
                    delete merged.readOnly
                    delete merged.encodingIssue
                    delete merged.largeFile
                    return merged
                }
                tabsRef.current = [...restored, ...opened.map(withRecovered)]
                // Merged into the latest state, so a keystroke queued in the same update isn't lost.
                setTabs((prev) => [...notOpen(prev), ...prev.map(withRecovered)])
                for (const t of recovered) {
                    if (left.includes(t)) continue
                    const id = openTab(opened, t.path)!.id
                    coordinator.replaceEditorText.current(id, t.content)
                    // Copied again, as after any edit, so the text is kept even if its copy went while the file was open.
                    coordinator.scheduleBackup.current(id)
                    dismissNotification(readOnlyNoticeId(id))
                }
                if (!activeTabIdRef.current || !opened.some((t) => t.id === activeTabIdRef.current)) setActiveTabId(nextActiveId)
                for (const tab of restored) explainReadOnlyFile(tab)
                return left
            },
            reloadTabFromDisk: async (id) => {
                await reloadTab(id, false)
            },
            reloadChangedTabs: async (paths) => {
                // Each tab costs a look at its file, so only those at (or inside) the paths given, when there are some.
                const named = (t: DocumentTab) => !paths || paths.some((p) => samePath(t.path, p) || isPathInside(t.path, p))
                const unedited = tabsRef.current.filter(
                    (t) => !t.isDirty && !t.isSaving && !t.readOnly && t.disk?.stamp && !isExampleTabId(t.id) && named(t)
                )
                await Promise.all(
                    unedited.map(async (tab) => {
                        const now = await readStamp(tab.path)
                        // A deleted file stays open as it was: saving it asks first. A file that grew very large isn't
                        // read without asking, as opening one isn't.
                        if (!now || !stampChanged(tab.disk!.stamp!, now) || isLargeFile(now.size)) return
                        try {
                            await reloadTab(tab.id, true)
                        } catch (err) {
                            // Shown as it was; saving it later asks about the change.
                            console.warn(`Couldn't reload ${tab.name}`, err)
                        }
                    })
                )
            },
        })
    }, [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef, explainReadOnlyFile, releaseTabs, reloadTab])

    const openFile = useCallback(
        async (requestedPath: string) => {
            const fileName = getBaseName(requestedPath)
            if (!isSupportedDocument(fileName)) {
                await showError('Unsupported file', `Scrivon supports ${supportedExtensionsLabel('and')} files only.`)
                return
            }

            const path = normalizePath(requestedPath)
            const previousId = activeTabIdRef.current
            lastRequestedRef.current = path

            const existing = tabsRef.current.find((t) => samePath(t.path, path))
            if (existing) {
                lastRequestedRef.current = existing.id
                setActiveTabId(existing.id)
                void persistTabSession({ tabs: tabsRef.current, activeTabId: existing.id })
                recordRecentFile(existing.id)
                if (previousId && previousId !== existing.id) coordinator.flushSaveOnTabLeave.current(previousId)
                return
            }

            const pending = [...pendingOpens.current].find(([p]) => samePath(p, path))?.[1]
            if (pending) return pending

            if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)

            const generation = tabsGeneration.current
            const stale = () => generation !== tabsGeneration.current
            const open = (async () => {
                // Only reading the file can make the open fail; remembering it afterwards is best-effort.
                let read: DocumentTab
                try {
                    // A huge file can make the app stop responding for a while, so the user decides before it is read.
                    const size = await getWorkspaceFileSize(path)
                    if (stale()) return
                    if (isLargeFile(size) && !(await confirmOpenLargeFile(fileName, formatFileSize(size)))) return
                    if (stale()) return
                    read = tabFromFile(path, await readWorkspaceTextFile(path))
                } catch (err) {
                    if (stale()) return
                    // Only a file that isn't there leaves the list; a locked one may open next time.
                    if (isFileMissingError(err)) forgetRecentFile(path)
                    await showError('Open failed', err instanceof Error ? err.message : 'Could not read file')
                    return
                }
                // The folder it was in was switched or closed while it was read.
                if (stale()) return
                // Restoring a folder's tabs may have opened it meanwhile; that tab is kept, never a second copy.
                const alreadyOpen = tabsRef.current.find((t) => samePath(t.path, path))
                const tab = alreadyOpen ?? read
                if (!alreadyOpen) {
                    tabsRef.current = [...tabsRef.current, tab]
                    setTabs((prev) => (prev.some((t) => samePath(t.path, tab.path)) ? prev : [...prev, tab]))
                    explainReadOnlyFile(tab)
                }
                const isLatest = lastRequestedRef.current !== null && samePath(lastRequestedRef.current, path)
                if (isLatest) {
                    activeTabIdRef.current = tab.id
                    setActiveTabId(tab.id)
                    coordinator.requestCanvasFit.current()
                }
                await persistTabSession({ tabs: tabsRef.current, activeTabId: activeTabIdRef.current })
                if (isLatest) recordRecentFile(tab.id)
            })()
            pendingOpens.current.set(path, open)
            void open.finally(() => {
                // Not a newer open of the same path, started after the folder changed.
                if (pendingOpens.current.get(path) === open) pendingOpens.current.delete(path)
            })
            return open
        },
        [coordinator, persistTabSession, recordRecentFile, forgetRecentFile, setTabs, setActiveTabId, tabsRef, explainReadOnlyFile]
    )

    const openExample = useCallback(
        (exampleId: string) => {
            const example = APP_EXAMPLE_BY_ID[exampleId]
            if (!example) {
                void showError('Example not found', `No example with id "${exampleId}"`)
                return
            }

            const tabId = exampleTabId(exampleId)
            const previousId = activeTabIdRef.current
            lastRequestedRef.current = tabId

            const existing = tabsRef.current.find((t) => t.id === tabId)
            if (existing) {
                setActiveTabId(tabId)
                if (previousId && previousId !== tabId) coordinator.flushSaveOnTabLeave.current(previousId)
                return
            }

            if (previousId && previousId !== tabId) coordinator.flushSaveOnTabLeave.current(previousId)

            const tab = tabFromExample(example)
            setTabs((prev) => [...prev, tab])
            setActiveTabId(tabId)
            coordinator.requestCanvasFit.current()
        },
        [coordinator, setTabs, setActiveTabId, tabsRef]
    )

    const setActiveTab = useCallback(
        async (id: string) => {
            lastRequestedRef.current = id
            if (activeTabIdRef.current === id) return
            const previousId = activeTabIdRef.current
            setActiveTabId(id)
            if (!isExampleTabId(id)) {
                void persistTabSession({ tabs: tabsRef.current, activeTabId: id })
                recordRecentFile(id)
            }
            if (previousId) coordinator.flushSaveOnTabLeave.current(previousId)
        },
        [coordinator, persistTabSession, recordRecentFile, setActiveTabId, tabsRef]
    )

    const updateTabContent = useCallback(
        (id: string, content: string) => {
            const tab = tabsRef.current.find((t) => t.id === id)
            if (tab?.readOnly) return
            // A save error stays until a save works, so typing doesn't hide that edits aren't reaching the disk.
            const typed = (t: DocumentTab) => (t.id === id ? { ...t, content, isDirty: true } : t)
            // The ref changes straight away too, so a save or restore finishing before React draws again sees this
            // keystroke (a save would otherwise think the tab clean and drop the copy of it).
            tabsRef.current = tabsRef.current.map(typed)
            setTabs((prev) => prev.map(typed))
            coordinator.scheduleSave.current(id)
            coordinator.scheduleBackup.current(id)
        },
        [coordinator, setTabs, tabsRef]
    )

    const resolveUnsavedTabs = useCallback(
        async (closingNow: () => DocumentTab[]): Promise<boolean> => {
            const editable = closingNow().filter((t) => !t.readOnly)
            let toSave: DocumentTab[] = []
            if (coordinator.getAutosaveEnabled.current()) {
                toSave = editable
            } else {
                const dirty = editable.filter((t) => t.isDirty)
                if (dirty.length > 0) {
                    const choice = await confirmUnsavedChanges(dirty.map((t) => t.name))
                    if (choice === 'cancel') return false
                    if (choice === 'save') toSave = dirty
                }
            }

            // Tabs whose save failed and that the user chose to close without saving.
            const discarded = new Set<string>()
            // Text typed into a closing tab while the saves ran (or into one that had no edits then) isn't on disk
            // yet, and the tabs are about to go: it is saved too, unless the user let that tab go unsaved.
            const stillEdited = () => closingNow().filter((t) => !t.readOnly && t.isDirty && !discarded.has(t.id))
            let rounds = 0
            while (toSave.length > 0) {
                rounds += 1
                const results = await Promise.all(
                    toSave.map(async (tab) => ({
                        tab,
                        result: await saveWithin(
                            coordinator.flushSave.current(tab.id),
                            SAVE_BEFORE_CLOSE_TIMEOUT_MS,
                            coordinator.isAskingUser.current
                        ),
                    }))
                )
                let failed: Array<{ tab: DocumentTab; result: boolean | 'timeout' | 'edited' }> = results.filter((r) => r.result !== true)
                if (failed.length === 0) {
                    // Saved again until none is left. Someone still typing after a few rounds is asked, as for a
                    // save that failed.
                    toSave = stillEdited()
                    if (toSave.length === 0) break
                    if (rounds < MAX_SAVE_ROUNDS_BEFORE_CLOSE) continue
                    failed = toSave.map((tab) => ({ tab, result: 'edited' }))
                }
                // A save that timed out is still running, and saves of one tab wait their turn, so another try
                // can only wait for it: the question says so.
                const choice = await confirmCloseAfterSaveFailure(
                    failed.map(({ tab, result }) =>
                        result === 'timeout'
                            ? { name: tab.name, stillSaving: true }
                            : result === 'edited'
                              ? { name: tab.name, error: EDITED_WHILE_SAVING }
                              : { name: tab.name, error: coordinator.getSaveError.current(tab.id) }
                    )
                )
                if (choice === 'cancel') return false
                rounds = 0
                if (choice === 'discard') {
                    // Only the tabs the question named go unsaved; another closing tab typed in meanwhile is saved.
                    for (const { tab } of failed) discarded.add(tab.id)
                    toSave = stillEdited()
                } else {
                    toSave = failed.map((r) => r.tab)
                }
            }
            return true
        },
        [coordinator]
    )

    // The close question being answered (or the saves it waits for) right now, and the tabs it is about.
    const runningConfirm = useRef<{ ids: ReadonlySet<string>; done: Promise<boolean> } | null>(null)

    const confirmCloseTabs = useCallback(
        async (ids?: readonly string[]): Promise<boolean> => {
            const closingNow = () => (ids ? tabsRef.current.filter((t) => ids.includes(t.id)) : tabsRef.current)
            // One question at a time. A second request while one runs (a second click on X, another folder picked
            // during a slow save) gets that one's answer when it is about the same tabs or fewer, and otherwise
            // asks about its own tabs once the first is done, so neither is quietly dropped.
            while (runningConfirm.current) {
                const running = runningConfirm.current
                if (closingNow().every((t) => running.ids.has(t.id))) return running.done
                await running.done
                // Lets the request that asked first close its tabs, so only the ones left are asked about.
                await new Promise((resolve) => setTimeout(resolve, 0))
            }
            const closing = closingNow()
            const done = resolveUnsavedTabs(closingNow).catch((err: unknown) => {
                notifyError("Couldn't close the files", err)
                return false
            })
            runningConfirm.current = { ids: new Set(closing.map((t) => t.id)), done }
            void done.finally(() => {
                if (runningConfirm.current?.done === done) runningConfirm.current = null
            })
            return done
        },
        [resolveUnsavedTabs, tabsRef]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { confirmCloseTabs })
    }, [coordinator, confirmCloseTabs])

    const closeTab = useCallback(
        async (id: string) => {
            if (!(await confirmCloseTabs([id]))) return
            releaseTabs(tabsRef.current.filter((t) => t.id === id))
            const prev = tabsRef.current
            const nextTabs = prev.filter((t) => t.id !== id)
            let nextActiveId = activeTabIdRef.current
            if (activeTabIdRef.current === id) {
                const closedIndex = prev.findIndex((t) => t.id === id)
                const fallback = nextTabs[Math.min(closedIndex, nextTabs.length - 1)]
                nextActiveId = fallback?.id ?? null
                activeTabIdRef.current = nextActiveId
                setActiveTabId(nextActiveId)
            }
            // The ref changes straight away and the state with an update, so a change queued for another tab is kept.
            tabsRef.current = nextTabs
            setTabs((current) => current.filter((t) => t.id !== id))
            void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
        },
        [confirmCloseTabs, releaseTabs, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeOtherTabs = useCallback(
        async (keepId: string) => {
            const idsToClose = tabsRef.current.filter((t) => t.id !== keepId).map((t) => t.id)
            if (!(await confirmCloseTabs(idsToClose))) return
            const closing = new Set(idsToClose)
            releaseTabs(tabsRef.current.filter((t) => closing.has(t.id)))
            const nextTabs = tabsRef.current.filter((t) => !closing.has(t.id))
            tabsRef.current = nextTabs
            setTabs((current) => current.filter((t) => !closing.has(t.id)))
            activeTabIdRef.current = keepId
            setActiveTabId(keepId)
            await persistTabSession({ tabs: nextTabs, activeTabId: keepId })
        },
        [confirmCloseTabs, releaseTabs, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeAllTabs = useCallback(async () => {
        if (!(await confirmCloseTabs())) return
        releaseTabs(tabsRef.current)
        tabsRef.current = []
        activeTabIdRef.current = null
        setTabs([])
        setActiveTabId(null)
        await persistTabSession({ tabs: [], activeTabId: null })
    }, [confirmCloseTabs, releaseTabs, persistTabSession, setTabs, setActiveTabId, tabsRef])

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { openFile })
    }, [coordinator, openFile])

    const actions = useMemo<DocumentTabActions>(
        () => ({ openFile, openExample, setActiveTab, updateTabContent, closeTab, closeOtherTabs, closeAllTabs, makeTabEditable }),
        [openFile, openExample, setActiveTab, updateTabContent, closeTab, closeOtherTabs, closeAllTabs, makeTabEditable]
    )

    const value = useMemo(() => ({ ...actions, tabs, activeTabId, activeTab }), [actions, tabs, activeTabId, activeTab])

    // Split up so a part of the screen that only opens files or marks the open one, such as each row of the
    // file tree, isn't drawn again for every character typed.
    return (
        <DocumentTabActionsContext.Provider value={actions}>
            <ActiveTabIdContext.Provider value={activeTabId}>
                <DocumentTabsContext.Provider value={value}>{children}</DocumentTabsContext.Provider>
            </ActiveTabIdContext.Provider>
        </DocumentTabActionsContext.Provider>
    )
}

export function useDocumentTabsState(): DocumentTabsState {
    const [tabs, setTabs] = useState<DocumentTab[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const tabsRef = useRef(tabs)

    useEffect(() => {
        tabsRef.current = tabs
    }, [tabs])

    return { tabs, setTabs, activeTabId, setActiveTabId, tabsRef }
}
