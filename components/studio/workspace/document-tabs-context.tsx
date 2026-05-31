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
import { showError } from '@/lib/tauri/dialog'
import { getBaseName, isSupportedDocument, readWorkspaceFile } from '@/lib/tauri/fs'
import { setWorkspaceTabSession, addRecentFile } from '@/lib/tauri/store'
import { tabFromPath } from '@/lib/workspace/document-tab'
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

    useEffect(() => {
        registerCoordinatorRefs(coordinator, {
            remapTabsAfterRename: (oldPath, newPath, newName) => {
                const nextTabs = remapTabsAfterRename(tabsRef.current, oldPath, newPath, newName)
                const nextActiveId = activeTabIdRef.current === oldPath ? newPath : activeTabIdRef.current
                setTabs(nextTabs)
                if (activeTabIdRef.current === oldPath) setActiveTabId(newPath)
                void persistTabSession({ tabs: nextTabs, activeTabId: nextActiveId })
            },
            closeTabsForDelete: (path, isDirectory) => {
                const toClose = tabsToCloseOnDelete(tabsRef.current, path, isDirectory)
                for (const tab of toClose) {
                    coordinator.cancelScheduledSave.current(tab.id)
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
            setTabsFromWorkspace: (nextTabs, nextActiveId) => {
                setTabs(nextTabs)
                setActiveTabId(nextActiveId)
            },
        })
    }, [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef])

    const openFile = useCallback(
        async (path: string) => {
            const fileName = getBaseName(path)
            if (!isSupportedDocument(fileName)) {
                await showError('Unsupported file', 'Scrivon supports .md and .mmd files only.')
                return
            }

            const previousId = activeTabIdRef.current

            const existing = tabsRef.current.find((t) => t.id === path)
            if (existing) {
                setActiveTabId(path)
                void persistTabSession({ tabs: tabsRef.current, activeTabId: path })
                if (workspaceRoot) void addRecentFile(workspaceRoot, path)
                if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)
                return
            }

            if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)

            try {
                const content = await readWorkspaceFile(path)
                const tab = tabFromPath(path, content)
                const nextTabs = [...tabsRef.current, tab]
                setTabs(nextTabs)
                setActiveTabId(path)
                coordinator.requestCanvasFit.current()
                await persistTabSession({ tabs: nextTabs, activeTabId: path })
                if (workspaceRoot) void addRecentFile(workspaceRoot, path)
            } catch (err) {
                await showError('Open failed', err instanceof Error ? err.message : 'Could not read file')
            }
        },
        [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef, workspaceRoot]
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
            setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content, isDirty: true, saveError: undefined } : t)))
            coordinator.scheduleSave.current(id)
        },
        [coordinator, setTabs, tabsRef]
    )

    const closeTab = useCallback(
        async (id: string) => {
            if (coordinator.getAutosaveEnabled.current()) {
                await coordinator.flushSave.current(id)
            } else {
                coordinator.cancelScheduledSave.current(id)
            }
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
        [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeOtherTabs = useCallback(
        async (keepId: string) => {
            const idsToClose = tabsRef.current.filter((t) => t.id !== keepId).map((t) => t.id)
            for (const id of idsToClose) {
                if (coordinator.getAutosaveEnabled.current()) {
                    await coordinator.flushSave.current(id)
                } else {
                    coordinator.cancelScheduledSave.current(id)
                }
            }
            const nextTabs = tabsRef.current.filter((t) => t.id === keepId)
            setTabs(nextTabs)
            setActiveTabId(keepId)
            await persistTabSession({ tabs: nextTabs, activeTabId: keepId })
        },
        [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef]
    )

    const closeAllTabs = useCallback(async () => {
        const idsToClose = tabsRef.current.map((t) => t.id)
        for (const id of idsToClose) {
            if (coordinator.getAutosaveEnabled.current()) {
                await coordinator.flushSave.current(id)
            } else {
                coordinator.cancelScheduledSave.current(id)
            }
        }
        setTabs([])
        setActiveTabId(null)
        await persistTabSession({ tabs: [], activeTabId: null })
    }, [coordinator, persistTabSession, setTabs, setActiveTabId, tabsRef])

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
