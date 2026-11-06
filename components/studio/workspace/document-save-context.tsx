'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { dismissNotification, errorMessage, notifyError } from '@/lib/notify'
import { confirmOverwriteDiskChange, type DiskChange } from '@/lib/tauri/dialog'
import { DiskChangedError, writeWorkspaceFile } from '@/lib/tauri/fs'
import type { DocumentTab, FileStamp } from '@/lib/workspace/types'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
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

function saveErrorToastId(tabId: string): string {
    return `save-error:${tabId}`
}

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
    const { settings, setAutosaveEnabled } = useAppSettings()
    const autosaveEnabled = settings.autosave.enabled
    const autosaveDelayMs = settings.autosave.delayMs
    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const inFlightSaves = useRef<Map<string, Promise<boolean>>>(new Map())
    // Read right after a failed save, before React has put the error on the tab.
    const saveErrors = useRef<Map<string, string>>(new Map())
    const autosaveEnabledRef = useRef(autosaveEnabled)
    const autosaveDelayMsRef = useRef(autosaveDelayMs)

    useEffect(() => {
        autosaveEnabledRef.current = autosaveEnabled
    }, [autosaveEnabled])

    useEffect(() => {
        autosaveDelayMsRef.current = autosaveDelayMs
    }, [autosaveDelayMs])

    useEffect(() => {
        if (autosaveEnabled) return
        for (const timer of saveTimers.current.values()) clearTimeout(timer)
        saveTimers.current.clear()
    }, [autosaveEnabled])

    // One question about a file changed on disk at a time, so saves of several tabs can't stack dialogs.
    const diskQuestion = useRef<Promise<unknown>>(Promise.resolve())
    const openDiskQuestions = useRef(0)

    const askToOverwrite = useCallback((fileName: string, change: DiskChange): Promise<boolean> => {
        openDiskQuestions.current += 1
        const answer = diskQuestion.current.then(() => confirmOverwriteDiskChange(fileName, change))
        diskQuestion.current = answer.catch(() => undefined)
        return answer.finally(() => {
            openDiskQuestions.current -= 1
        })
    }, [])

    const writeTab = useCallback(
        async (id: string, silent: boolean): Promise<boolean> => {
            const tab = tabsRef.current.find((t) => t.id === id)
            if (!tab || tab.readOnly || !tab.isDirty) return true
            const disk = tab.disk
            // The user chose not to save over a change made elsewhere: only an explicit save asks again.
            if (silent && disk?.conflict) return false

            const content = tab.content
            if (!silent) {
                // Any earlier save error stays on the tab until a save actually works.
                setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: true } : t)))
            }

            try {
                let stamp: FileStamp | null
                try {
                    // Refused if the file was changed or deleted outside Scrivon since it was read or last saved.
                    stamp = await writeWorkspaceFile(tab.path, content, { format: tab.format, expected: disk ? disk.stamp : undefined })
                } catch (err) {
                    if (!(err instanceof DiskChangedError) || !disk) throw err
                    if (!(await askToOverwrite(tab.name, err.change))) {
                        disk.conflict = err.change
                        throw err
                    }
                    stamp = await writeWorkspaceFile(tab.path, content, { format: tab.format })
                }
                if (disk) {
                    disk.stamp = stamp
                    disk.conflict = undefined
                }
                if (saveErrors.current.delete(id)) dismissNotification(saveErrorToastId(id))
                // Anything typed while the write was running is not on disk yet, so keep the tab dirty.
                const markSaved = (t: DocumentTab) =>
                    t.id === id ? { ...t, isDirty: t.content !== content, isSaving: false, saveError: undefined } : t
                // A save queued behind this one starts before React re-renders, so it must already see this one's result.
                tabsRef.current = tabsRef.current.map(markSaved)
                setTabs((prev) => prev.map(markSaved))
                return true
            } catch (err) {
                const message = errorMessage(err, 'Failed to save file')
                // Tell the user once per run of failures; autosave would otherwise repeat it after every pause in typing.
                if (!saveErrors.current.has(id)) {
                    notifyError(`Couldn't save ${tab.name}`, err, {
                        id: saveErrorToastId(id),
                        description: message,
                        timeout: 0,
                        action: {
                            label: 'Try Again',
                            onClick: () => {
                                dismissNotification(saveErrorToastId(id))
                                saveErrors.current.delete(id)
                                void coordinator.flushSave.current(id)
                            },
                        },
                    })
                }
                saveErrors.current.set(id, message)
                setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: false, saveError: message } : t)))
                return false
            }
        },
        [askToOverwrite, coordinator, setTabs, tabsRef]
    )

    const flushSave = useCallback(
        (id: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
            const timer = saveTimers.current.get(id)
            if (timer) {
                clearTimeout(timer)
                saveTimers.current.delete(id)
            }

            // Saves for one tab run one after another, so an older write can never land after a newer one.
            const previous = inFlightSaves.current.get(id)
            const run = previous ? previous.then(() => writeTab(id, silent)) : writeTab(id, silent)
            inFlightSaves.current.set(id, run)
            void run.finally(() => {
                if (inFlightSaves.current.get(id) === run) inFlightSaves.current.delete(id)
            })
            return run
        },
        [writeTab]
    )

    const flushAllSaves = useCallback(async (): Promise<boolean> => {
        const ids = new Set([...tabsRef.current.filter((t) => t.isDirty).map((t) => t.id), ...inFlightSaves.current.keys()])
        const results = await Promise.all([...ids].map((id) => flushSave(id)))
        return results.every(Boolean)
    }, [flushSave, tabsRef])

    const scheduleSave = useCallback(
        (id: string) => {
            if (!autosaveEnabledRef.current) return
            const tab = tabsRef.current.find((t) => t.id === id)
            // A tab whose file changed elsewhere waits for the user (Try Again on its notice, or closing it).
            if (tab?.readOnly || tab?.disk?.conflict) return

            const existing = saveTimers.current.get(id)
            if (existing) clearTimeout(existing)

            const timer = setTimeout(() => {
                saveTimers.current.delete(id)
                void flushSave(id)
            }, autosaveDelayMsRef.current)

            saveTimers.current.set(id, timer)
        },
        [flushSave, tabsRef]
    )

    const cancelScheduledSave = useCallback((id: string) => {
        const timer = saveTimers.current.get(id)
        if (timer) {
            clearTimeout(timer)
            saveTimers.current.delete(id)
        }
        // The tab is closing, so its "couldn't save" notice no longer applies.
        if (saveErrors.current.delete(id)) dismissNotification(saveErrorToastId(id))
    }, [])

    const flushSaveOnTabLeave = useCallback(
        (id: string) => {
            if (!autosaveEnabledRef.current) return
            void flushSave(id, { silent: true })
        },
        [flushSave]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, {
            flushAllSaves,
            flushSave,
            flushSaveOnTabLeave,
            scheduleSave,
            cancelScheduledSave,
            getAutosaveEnabled: () => autosaveEnabledRef.current,
            getSaveError: (id) => saveErrors.current.get(id),
            isAskingUser: () => openDiskQuestions.current > 0,
        })
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
