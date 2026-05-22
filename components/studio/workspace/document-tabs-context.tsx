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
import { CRAFT_EXAMPLE_BY_ID } from '@/lib/examples/craft-samples'
import { exampleTabId, isExampleTabId, tabFromExample } from '@/lib/examples/example-tab'
import { showError } from '@/lib/tauri/dialog'
import { readWorkspaceFile } from '@/lib/tauri/fs'
import { setLastOpenedFile } from '@/lib/tauri/store'
import { tabFromPath } from '@/lib/workspace/document-tab'
import { remapTabsAfterRename, tabsToCloseOnDelete } from '@/lib/workspace/tab-paths'
import type { DocumentTab } from '@/lib/workspace/types'
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
    activeTabIdRef.current = activeTabId

    const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId])

    useEffect(() => {
        coordinator.remapTabsAfterRename.current = (oldPath, newPath, newName) => {
            setTabs((prev) => remapTabsAfterRename(prev, oldPath, newPath, newName))
            if (activeTabIdRef.current === oldPath) setActiveTabId(newPath)
        }
        coordinator.closeTabsForDelete.current = (path, isDirectory) => {
            const toClose = tabsToCloseOnDelete(tabsRef.current, path, isDirectory)
            for (const tab of toClose) {
                coordinator.cancelScheduledSave.current(tab.id)
            }
            const closingIds = new Set(toClose.map((t) => t.id))
            setTabs((prev) => {
                const next = prev.filter((t) => !closingIds.has(t.id))
                if (activeTabIdRef.current && closingIds.has(activeTabIdRef.current)) {
                    setActiveTabId(next[0]?.id ?? null)
                }
                return next
            })
        }
        coordinator.clearTabs.current = () => {
            setTabs([])
            setActiveTabId(null)
        }
        coordinator.setTabsFromWorkspace.current = (nextTabs, nextActiveId) => {
            setTabs(nextTabs)
            setActiveTabId(nextActiveId)
        }
    }, [coordinator, setTabs, setActiveTabId, tabsRef])

    const openFile = useCallback(
        async (path: string) => {
            const previousId = activeTabIdRef.current

            const existing = tabsRef.current.find((t) => t.id === path)
            if (existing) {
                setActiveTabId(path)
                if (workspaceRoot) void setLastOpenedFile(workspaceRoot, path)
                if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)
                return
            }

            if (previousId && previousId !== path) coordinator.flushSaveOnTabLeave.current(previousId)

            try {
                const content = await readWorkspaceFile(path)
                const tab = tabFromPath(path, content)
                setTabs((prev) => [...prev, tab])
                setActiveTabId(path)
                coordinator.requestCanvasFit.current()
                if (workspaceRoot) await setLastOpenedFile(workspaceRoot, path)
            } catch (err) {
                await showError('Open failed', err instanceof Error ? err.message : 'Could not read file')
            }
        },
        [coordinator, workspaceRoot, setTabs, setActiveTabId, tabsRef]
    )

    const openExample = useCallback(
        (exampleId: string) => {
            const example = CRAFT_EXAMPLE_BY_ID[exampleId]
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
            if (workspaceRoot && !isExampleTabId(id)) void setLastOpenedFile(workspaceRoot, id)
            if (previousId) coordinator.flushSaveOnTabLeave.current(previousId)
        },
        [coordinator, workspaceRoot, setActiveTabId]
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
            setTabs((prev) => {
                const next = prev.filter((t) => t.id !== id)
                if (activeTabIdRef.current === id) {
                    const closedIndex = prev.findIndex((t) => t.id === id)
                    const fallback = next[Math.min(closedIndex, next.length - 1)]
                    setActiveTabId(fallback?.id ?? null)
                }
                return next
            })
        },
        [coordinator, setTabs, setActiveTabId]
    )

    useEffect(() => {
        coordinator.openFile.current = openFile
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
        }),
        [tabs, activeTabId, activeTab, openFile, openExample, setActiveTab, updateTabContent, closeTab]
    )

    return <DocumentTabsContext.Provider value={value}>{children}</DocumentTabsContext.Provider>
}

export function useDocumentTabsState(): DocumentTabsState {
    const [tabs, setTabs] = useState<DocumentTab[]>([])
    const [activeTabId, setActiveTabId] = useState<string | null>(null)
    const tabsRef = useRef(tabs)
    tabsRef.current = tabs
    return { tabs, setTabs, activeTabId, setActiveTabId, tabsRef }
}
