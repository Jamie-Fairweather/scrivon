'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { dismissNotification, errorMessage, notifyError } from '@/lib/notify'
import { deleteUnsavedBackup, saveUnsavedBackup } from '@/lib/tauri/backups'
import { confirmOverwriteDiskChange, type DiskChange } from '@/lib/tauri/dialog'
import { DiskChangedError, writeWorkspaceFile } from '@/lib/tauri/fs'
import { tabsToCloseOnDelete } from '@/lib/workspace/tab-paths'
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

/** How long after the last keystroke a copy of unsaved text is kept, whether autosave is on or off. */
export const BACKUP_DELAY_MS = 1000

/** Text longer than this isn't copied on every pause: rewriting it would slow typing down. */
const MAX_BACKUP_LENGTH = 5_000_000

function warnBackupFailed(err: unknown) {
    // Only the safety net failed; saving still works, so the user isn't interrupted.
    console.warn("Couldn't keep a copy of unsaved changes", err)
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
    /** The open folder, kept with each copy of unsaved text so the app can offer to reopen it after a crash. */
    workspaceRoot?: string | null
}

export function DocumentSaveProvider({ children, coordinator, tabsRef, setTabs, workspaceRoot = null }: DocumentSaveProviderProps) {
    const { settings, setAutosaveEnabled } = useAppSettings()
    const autosaveEnabled = settings.autosave.enabled
    const autosaveDelayMs = settings.autosave.delayMs
    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const backupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const inFlightSaves = useRef<Map<string, Promise<boolean>>>(new Map())
    // Read right after a failed save, before React has put the error on the tab.
    const saveErrors = useRef<Map<string, string>>(new Map())
    const autosaveEnabledRef = useRef(autosaveEnabled)
    const autosaveDelayMsRef = useRef(autosaveDelayMs)
    const workspaceRootRef = useRef(workspaceRoot)

    useEffect(() => {
        autosaveEnabledRef.current = autosaveEnabled
    }, [autosaveEnabled])

    useEffect(() => {
        autosaveDelayMsRef.current = autosaveDelayMs
    }, [autosaveDelayMs])

    useEffect(() => {
        workspaceRootRef.current = workspaceRoot
    }, [workspaceRoot])

    /** Writes (or, once the tab is clean, removes) the copy of a tab's unsaved text. */
    const writeBackup = useCallback(
        (id: string) => {
            const tab = tabsRef.current.find((t) => t.id === id)
            if (!tab || tab.readOnly || isExampleTabId(tab.id)) return
            if (!tab.isDirty) {
                void deleteUnsavedBackup(tab.path).catch(warnBackupFailed)
                return
            }
            if (tab.content.length > MAX_BACKUP_LENGTH) return
            void saveUnsavedBackup({
                path: tab.path,
                root: workspaceRootRef.current,
                content: tab.content,
                format: tab.format,
                stamp: tab.disk?.stamp ?? null,
                savedAt: Date.now(),
            }).catch(warnBackupFailed)
        },
        [tabsRef]
    )

    const scheduleBackup = useCallback(
        (id: string) => {
            const existing = backupTimers.current.get(id)
            if (existing) clearTimeout(existing)
            const timer = setTimeout(() => {
                backupTimers.current.delete(id)
                writeBackup(id)
            }, BACKUP_DELAY_MS)
            backupTimers.current.set(id, timer)
        },
        [writeBackup]
    )

    /** The text is on disk, or the user chose to drop it: the copy is no longer needed. */
    const clearBackup = useCallback((id: string, path: string) => {
        const timer = backupTimers.current.get(id)
        if (timer) {
            clearTimeout(timer)
            backupTimers.current.delete(id)
        }
        void deleteUnsavedBackup(path).catch(warnBackupFailed)
    }, [])

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
                const saved = tabsRef.current.find((t) => t.id === id)
                if (saved && !saved.isDirty) clearBackup(id, saved.path)
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
        [askToOverwrite, clearBackup, coordinator, setTabs, tabsRef]
    )

    // Tabs whose file is being renamed or deleted. A save asked for meanwhile waits, then goes to wherever
    // the tab is afterwards, so it can never bring back the old file or be dropped.
    const holds = useRef(new Map<string, { whereNow: Promise<string | null>; wantsSave: boolean }>())
    const flushSaveRef = useRef<(id: string, options?: { silent?: boolean }) => Promise<boolean>>(async () => true)

    const flushSave = useCallback(
        (id: string, { silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
            const hold = holds.current.get(id)
            if (hold) return hold.whereNow.then((next) => (next ? flushSaveRef.current(next, { silent }) : true))

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

    useEffect(() => {
        flushSaveRef.current = flushSave
    }, [flushSave])

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
            const hold = holds.current.get(id)
            if (hold) {
                hold.wantsSave = true
                return
            }

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

    // Turning autosave off drops the saves that were due. Turning it on saves the tabs that already have
    // unsaved edits, instead of leaving them until the next keystroke.
    useEffect(() => {
        if (!autosaveEnabled) {
            for (const timer of saveTimers.current.values()) clearTimeout(timer)
            saveTimers.current.clear()
            return
        }
        for (const tab of tabsRef.current) {
            if (tab.isDirty && !tab.readOnly) scheduleSave(tab.id)
        }
    }, [autosaveEnabled, scheduleSave, tabsRef])

    const cancelScheduledSave = useCallback(
        (id: string) => {
            const timer = saveTimers.current.get(id)
            if (timer) {
                clearTimeout(timer)
                saveTimers.current.delete(id)
            }
            // The tab is closing: its edits were saved, or the user chose to close without saving them. A clean
            // tab's copy already went when it was saved, so closing it doesn't queue a write of the copies.
            const tab = tabsRef.current.find((t) => t.id === id)
            if (!tab || tab.isDirty) {
                clearBackup(id, tab?.path ?? id)
            } else {
                clearTimeout(backupTimers.current.get(id))
                backupTimers.current.delete(id)
            }
            // The tab is closing, so its "couldn't save" notice no longer applies.
            if (saveErrors.current.delete(id)) dismissNotification(saveErrorToastId(id))
        },
        [clearBackup, tabsRef]
    )

    const tabsMoved = useCallback(
        (moves: ReadonlyArray<{ from: string; to: string }>) => {
            for (const { from, to } of moves) {
                if (from === to) continue
                // The copy is kept under the file's path, so it moves with the file.
                clearBackup(from, from)
                scheduleBackup(to)
                // The notice named the old file. The tab keeps its error mark, and a new failure gets a new notice.
                if (saveErrors.current.delete(from)) dismissNotification(saveErrorToastId(from))
            }
        },
        [clearBackup, scheduleBackup]
    )

    const holdSaves = useCallback(
        async (path: string, isDirectory: boolean) => {
            const ids = tabsToCloseOnDelete(tabsRef.current, path, isDirectory).map((t) => t.id)
            let release!: (whereNow: (id: string) => string | null) => void
            const released = new Promise<(id: string) => string | null>((resolve) => (release = resolve))
            for (const id of ids) {
                const timer = saveTimers.current.get(id)
                if (timer) {
                    clearTimeout(timer)
                    saveTimers.current.delete(id)
                }
                holds.current.set(id, { whereNow: released.then((whereNow) => whereNow(id)), wantsSave: timer !== undefined })
            }
            // Writes already running finish first, so none lands on the old path after the file has moved or gone.
            await Promise.all(ids.map((id) => inFlightSaves.current.get(id)))
            return (whereNow: (id: string) => string | null) => {
                const wanted = ids.filter((id) => holds.current.get(id)?.wantsSave)
                for (const id of ids) holds.current.delete(id)
                release(whereNow)
                // An autosave that was due (or asked for meanwhile) is scheduled again, for the tab's new id.
                for (const id of wanted) {
                    const next = whereNow(id)
                    if (next) scheduleSave(next)
                }
            }
        },
        [scheduleSave, tabsRef]
    )

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
            scheduleBackup,
            cancelScheduledSave,
            tabsMoved,
            holdSaves,
            getAutosaveEnabled: () => autosaveEnabledRef.current,
            getSaveError: (id) => saveErrors.current.get(id),
            isAskingUser: () => openDiskQuestions.current > 0,
        })
    }, [coordinator, flushAllSaves, flushSave, flushSaveOnTabLeave, scheduleSave, scheduleBackup, cancelScheduledSave, tabsMoved, holdSaves])

    useEffect(() => {
        const timers = backupTimers.current
        return () => {
            for (const timer of timers.values()) clearTimeout(timer)
            timers.clear()
        }
    }, [])

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
