'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { writeWorkspaceFile } from '@/lib/tauri/fs'
import { AUTO_SAVE_MS, STORAGE_AUTOSAVE, type DocumentTab } from '@/lib/workspace/types'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type DocumentSaveContextValue = {
    autosaveEnabled: boolean
    setAutosaveEnabled: (enabled: boolean) => void
    flushSave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    scheduleSave: (id: string) => void
    flushSaveOnTabLeave: (id: string) => void
}

const DocumentSaveContext = createContext<DocumentSaveContextValue | null>(null)

export function useDocumentSave(): DocumentSaveContextValue {
    const ctx = useContext(DocumentSaveContext)
    if (!ctx) throw new Error('useDocumentSave must be used within WorkspaceProvider')
    return ctx
}

type DocumentSaveProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
    tabsRef: React.MutableRefObject<DocumentTab[]>
    setTabs: React.Dispatch<React.SetStateAction<DocumentTab[]>>
}

export function DocumentSaveProvider({ children, coordinator, tabsRef, setTabs }: DocumentSaveProviderProps) {
    const [autosaveEnabled, setAutosaveEnabledState] = useState(true)
    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const autosaveEnabledRef = useRef(autosaveEnabled)
    autosaveEnabledRef.current = autosaveEnabled

    useEffect(() => {
        const autosave = localStorage.getItem(STORAGE_AUTOSAVE)
        setAutosaveEnabledState(autosave !== 'false')
    }, [])

    const flushSave = useCallback(
        async (id: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
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
        },
        [setTabs, tabsRef]
    )

    const flushAllSaves = useCallback(async (): Promise<boolean> => {
        const dirtyIds = tabsRef.current.filter((t) => t.isDirty).map((t) => t.id)
        const results = await Promise.all(dirtyIds.map((id) => flushSave(id)))
        return results.every(Boolean)
    }, [flushSave, tabsRef])

    const scheduleSave = useCallback(
        (id: string) => {
            if (!autosaveEnabledRef.current) return

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

    const cancelScheduledSave = useCallback((id: string) => {
        const timer = saveTimers.current.get(id)
        if (timer) {
            clearTimeout(timer)
            saveTimers.current.delete(id)
        }
    }, [])

    const flushSaveOnTabLeave = useCallback(
        (id: string) => {
            if (!autosaveEnabledRef.current) return
            void flushSave(id, { silent: true })
        },
        [flushSave]
    )

    const setAutosaveEnabled = useCallback((enabled: boolean) => {
        setAutosaveEnabledState(enabled)
        localStorage.setItem(STORAGE_AUTOSAVE, String(enabled))
        if (!enabled) {
            for (const timer of saveTimers.current.values()) clearTimeout(timer)
            saveTimers.current.clear()
        }
    }, [])

    useEffect(() => {
        coordinator.flushAllSaves.current = flushAllSaves
        coordinator.flushSave.current = flushSave
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave
        coordinator.scheduleSave.current = scheduleSave
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.getAutosaveEnabled.current = () => autosaveEnabledRef.current
    }, [coordinator, flushAllSaves, flushSave, flushSaveOnTabLeave, scheduleSave, cancelScheduledSave])

    const value = useMemo(
        () => ({
            autosaveEnabled,
            setAutosaveEnabled,
            flushSave,
            flushAllSaves,
            scheduleSave,
            flushSaveOnTabLeave,
        }),
        [autosaveEnabled, setAutosaveEnabled, flushSave, flushAllSaves, scheduleSave, flushSaveOnTabLeave]
    )

    return <DocumentSaveContext.Provider value={value}>{children}</DocumentSaveContext.Provider>
}
