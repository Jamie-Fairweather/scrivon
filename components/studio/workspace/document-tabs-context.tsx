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
import { confirmCloseAfterSaveFailure, confirmOpenLargeFile, confirmUnsavedChanges, showError } from '@/lib/tauri/dialog'
import { getBaseName, getWorkspaceFileSize, isSupportedDocument, normalizePath, readWorkspaceTextFile, samePath } from '@/lib/tauri/fs'
import { setWorkspaceTabSession, addRecentFile } from '@/lib/tauri/store'
import { formatFileSize, isLargeFile, tabFromFile } from '@/lib/workspace/document-tab'
import { DEFAULT_TEXT_FORMAT } from '@/lib/workspace/text-encoding'
import { remapTabsAfterRename, tabsToCloseOnDelete } from '@/lib/workspace/tab-paths'
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
}

const DocumentTabsContext = createContext<DocumentTabsContextValue | null>(null)

/** How long closing waits for a save before treating it as failed (e.g. an offline network drive). */
const SAVE_BEFORE_CLOSE_TIMEOUT_MS = 10_000

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

export function useDocumentTabs(): DocumentTabsContextValue {
    const ctx = useContext(DocumentTabsContext)
    if (!ctx) throw new Error('useDocumentTabs must be used within WorkspaceProvider')
    return ctx
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
            await setWorkspaceTabSession(workspaceRoot, {
                tabIds: workspaceTabs.map((t) => t.id),
                activeTabId: resolvedActiveId,
            })
        },
        [workspaceRoot, tabsRef]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { persistWorkspaceTabSession: persistTabSession })
    }, [coordinator, persistTabSession])

    /** Lets the user edit a file that isn't UTF-8 after all; from then on it is saved as UTF-8. */
    const editAsUtf8 = useCallback(
        (id: string) => {
            dismissNotification(readOnlyNoticeId(id))
            setTabs((prev) =>
                prev.map((t) =>
                    t.id === id && t.encodingIssue === 'legacy-encoding'
                        ? { ...t, readOnly: false, encodingIssue: undefined, largeFile: undefined, format: DEFAULT_TEXT_FORMAT }
                        : t
                )
            )
        },
        [setTabs]
    )

    /** Lets the user edit a very large file anyway, knowing it may be slow. */
    const editLargeFile = useCallback(
        (id: string) => {
            dismissNotification(readOnlyNoticeId(id))
            setTabs((prev) => prev.map((t) => (t.id === id && t.largeFile && !t.encodingIssue ? { ...t, readOnly: false, largeFile: undefined } : t)))
        },
        [setTabs]
    )

    /**
     * Says why a file opened read-only: its bytes couldn't be read safely as text, and editing could damage
     * them, or it is so big that editing it would be slow.
     */
    const explainReadOnlyFile = useCallback(
        (tab: DocumentTab) => {
            const id = readOnlyNoticeId(tab.id)
            if (!tab.encodingIssue) {
                if (!tab.largeFile) return
                const size = tab.disk?.stamp?.size
                notifyWarning(`${tab.name} is read-only`, {
                    id,
                    description: `It's ${size ? formatFileSize(size) : 'very large'}, which is big enough to make editing slow.`,
                    timeout: 0,
                    action: { label: 'Edit Anyway', onClick: () => editLargeFile(tab.id) },
                })
                return
            }
            if (tab.encodingIssue === 'legacy-encoding') {
                notifyWarning(`${tab.name} is read-only`, {
                    id,
                    description:
                        "It isn't saved as UTF-8, so it's shown as Windows-1252 and left as it is. If you edit it, it will be saved as UTF-8.",
                    timeout: 0,
                    action: { label: 'Edit as UTF-8', onClick: () => editAsUtf8(tab.id) },
                })
                return
            }
            notifyWarning(`${tab.name} is read-only`, {
                id,
                description: "It looks like a binary file or uses a text encoding Scrivon can't read, so it's left as it is.",
                timeout: 0,
            })
        },
        [editAsUtf8, editLargeFile]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, {
            remapTabsAfterRename: (oldPath, newPath, newName) => {
                const prevTabs = tabsRef.current
                const nextTabs = remapTabsAfterRename(prevTabs, oldPath, newPath, newName)
                // The remap keeps tab order, so the active tab's new id sits at the same index.
                const activeIndex = prevTabs.findIndex((t) => t.id === activeTabIdRef.current)
                const nextActiveId = activeIndex >= 0 ? nextTabs[activeIndex]!.id : activeTabIdRef.current
                setTabs(nextTabs)
                if (nextActiveId !== activeTabIdRef.current) setActiveTabId(nextActiveId)
                coordinator.tabsMoved.current(
                    prevTabs.flatMap((t, i) => (t.isDirty && t.id !== nextTabs[i]!.id ? [{ from: t.id, to: nextTabs[i]!.id }] : []))
                )
                void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
            },
            closeTabsForDelete: (path, isDirectory) => {
                const toClose = tabsToCloseOnDelete(tabsRef.current, path, isDirectory)
                for (const tab of toClose) {
                    coordinator.cancelScheduledSave.current(tab.id)
                    dismissNotification(readOnlyNoticeId(tab.id))
                }
                const closingIds = new Set(toClose.map((t) => t.id))
                const nextTabs = tabsRef.current.filter((t) => !closingIds.has(t.id))
                const nextActiveId =
                    activeTabIdRef.current && closingIds.has(activeTabIdRef.current) ? (nextTabs[0]?.id ?? null) : activeTabIdRef.current
                setTabs(nextTabs)
                if (activeTabIdRef.current && closingIds.has(activeTabIdRef.current)) {
                    setActiveTabId(nextActiveId)
                }
                void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
            },
            clearTabs: () => {
                setTabs([])
                setActiveTabId(null)
            },
            getUnsavedContent: (path) => {
                const tab = tabsRef.current.find((t) => samePath(t.path, path))
                return tab?.isDirty ? tab.content : undefined
            },
            setTabsFromWorkspace: (nextTabs, nextActiveId) => {
                setTabs(nextTabs)
                setActiveTabId(nextActiveId)
                for (const tab of nextTabs) explainReadOnlyFile(tab)
            },
        })
    }, [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef, explainReadOnlyFile])

    const openFile = useCallback(
        async (requestedPath: string) => {
            const fileName = getBaseName(requestedPath)
            if (!isSupportedDocument(fileName)) {
                await showError('Unsupported file', 'Scrivon supports .md and .mmd files only.')
                return
            }

            const path = normalizePath(requestedPath)
            const previousId = activeTabIdRef.current

            const existing = tabsRef.current.find((t) => samePath(t.path, path))
            if (existing) {
                setActiveTabId(existing.id)
                void persistTabSession({ tabs: tabsRef.current, activeTabId: existing.id })
                if (workspaceRoot) void addRecentFile(workspaceRoot, existing.id)
                if (previousId && previousId !== existing.id) coordinator.flushSaveOnTabLeave.current(previousId)
                return
            }

            if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)

            try {
                // A huge file can make the app stop responding for a while, so the user decides before it is read.
                const size = await getWorkspaceFileSize(path)
                if (isLargeFile(size) && !(await confirmOpenLargeFile(fileName, formatFileSize(size)))) return
                const tab = tabFromFile(path, await readWorkspaceTextFile(path))
                const nextTabs = [...tabsRef.current, tab]
                setTabs(nextTabs)
                setActiveTabId(tab.id)
                explainReadOnlyFile(tab)
                coordinator.requestCanvasFit.current()
                await persistTabSession({ tabs: nextTabs, activeTabId: tab.id })
                if (workspaceRoot) void addRecentFile(workspaceRoot, tab.id)
            } catch (err) {
                await showError('Open failed', err instanceof Error ? err.message : 'Could not read file')
            }
        },
        [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef, workspaceRoot, explainReadOnlyFile]
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
            if (activeTabIdRef.current === id) return
            const previousId = activeTabIdRef.current
            setActiveTabId(id)
            if (!isExampleTabId(id)) {
                void persistTabSession({ tabs: tabsRef.current, activeTabId: id })
                if (workspaceRoot) void addRecentFile(workspaceRoot, id)
            }
            if (previousId) coordinator.flushSaveOnTabLeave.current(previousId)
        },
        [coordinator, persistTabSession, setActiveTabId, tabsRef, workspaceRoot]
    )

    const updateTabContent = useCallback(
        (id: string, content: string) => {
            const tab = tabsRef.current.find((t) => t.id === id)
            if (tab?.readOnly) return
            // A save error stays until a save works, so typing doesn't hide that edits aren't reaching the disk.
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content, isDirty: true } : t)))
            coordinator.scheduleSave.current(id)
            coordinator.scheduleBackup.current(id)
        },
        [coordinator, setTabs, tabsRef]
    )

    const resolveUnsavedTabs = useCallback(
        async (closing: DocumentTab[]): Promise<boolean> => {
            const editable = closing.filter((t) => !t.readOnly)
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

            while (toSave.length > 0) {
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
                const failed = results.filter((r) => r.result !== true)
                if (failed.length === 0) break
                const choice = await confirmCloseAfterSaveFailure(
                    failed.map(({ tab, result }) => ({
                        name: tab.name,
                        error: result === 'timeout' ? 'Saving is taking too long.' : coordinator.getSaveError.current(tab.id),
                    }))
                )
                if (choice === 'cancel') return false
                if (choice === 'discard') break
                toSave = failed.map((r) => r.tab)
            }

            for (const tab of closing) {
                coordinator.cancelScheduledSave.current(tab.id)
                dismissNotification(readOnlyNoticeId(tab.id))
            }
            return true
        },
        [coordinator]
    )

    const confirmingCloseRef = useRef(false)

    const confirmCloseTabs = useCallback(
        async (ids?: readonly string[]): Promise<boolean> => {
            // One question at a time: a second close request while one is being answered is ignored.
            if (confirmingCloseRef.current) return false
            confirmingCloseRef.current = true
            try {
                const closing = ids ? tabsRef.current.filter((t) => ids.includes(t.id)) : tabsRef.current
                return await resolveUnsavedTabs(closing)
            } catch (err) {
                notifyError("Couldn't close the files", err)
                return false
            } finally {
                confirmingCloseRef.current = false
            }
        },
        [resolveUnsavedTabs, tabsRef]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { confirmCloseTabs })
    }, [coordinator, confirmCloseTabs])

    const closeTab = useCallback(
        async (id: string) => {
            if (!(await confirmCloseTabs([id]))) return
            const prev = tabsRef.current
            const nextTabs = prev.filter((t) => t.id !== id)
            let nextActiveId = activeTabIdRef.current
            if (activeTabIdRef.current === id) {
                const closedIndex = prev.findIndex((t) => t.id === id)
                const fallback = nextTabs[Math.min(closedIndex, nextTabs.length - 1)]
                nextActiveId = fallback?.id ?? null
                setActiveTabId(nextActiveId)
            }
            setTabs(nextTabs)
            void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
        },
        [confirmCloseTabs, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeOtherTabs = useCallback(
        async (keepId: string) => {
            const idsToClose = tabsRef.current.filter((t) => t.id !== keepId).map((t) => t.id)
            if (!(await confirmCloseTabs(idsToClose))) return
            const nextTabs = tabsRef.current.filter((t) => t.id === keepId)
            setTabs(nextTabs)
            setActiveTabId(keepId)
            await persistTabSession({ tabs: nextTabs, activeTabId: keepId })
        },
        [confirmCloseTabs, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeAllTabs = useCallback(async () => {
        if (!(await confirmCloseTabs())) return
        setTabs([])
        setActiveTabId(null)
        await persistTabSession({ tabs: [], activeTabId: null })
    }, [confirmCloseTabs, persistTabSession, setTabs, setActiveTabId])

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { openFile })
    }, [coordinator, openFile])

    const value = useMemo(
        () => ({
            tabs,
            activeTabId,
            activeTab,
            openFile,
            openExample,
            setActiveTab,
            updateTabContent,
            closeTab,
            closeOtherTabs,
            closeAllTabs,
        }),
        [tabs, activeTabId, activeTab, openFile, openExample, setActiveTab, updateTabContent, closeTab, closeOtherTabs, closeAllTabs]
    )

    return <DocumentTabsContext.Provider value={value}>{children}</DocumentTabsContext.Provider>
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
