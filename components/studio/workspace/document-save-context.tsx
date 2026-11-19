'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { confirmOverwriteDiskChange, DiskChangeDialog, type DiskChange, type DiskChangeChoice } from '@/components/studio/dialogs/disk-change-dialog'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { dismissNotification, errorMessage, notifyError } from '@/lib/notify'
import { deleteUnsavedBackup, saveUnsavedBackup } from '@/lib/tauri/backups'
import { keepDiskVersion, recordFileVersion, type DiskVersionKind } from '@/lib/tauri/file-history'
import { comparablePath, DiskChangedError, writeWorkspaceFile } from '@/lib/tauri/fs'
import { tabsToCloseOnDelete } from '@/lib/workspace/tab-paths'
import type { DocumentTab, FileStamp } from '@/lib/workspace/types'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type DocumentSaveContextValue = {
    autosaveEnabled: boolean
    setAutosaveEnabled: (enabled: boolean) => void
    flushSave: (id: string) => Promise<boolean>
    /** Saves a tab again after a failed save, as its notice's Try Again does. */
    retrySave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    scheduleSave: (id: string) => void
    flushSaveOnTabLeave: (id: string) => void
}

const DocumentSaveContext = createContext<DocumentSaveContextValue | null>(null)

type SaveOptions = {
    /** No saving mark on the tab: for switching tabs. */
    silent?: boolean
    /**
     * A save the user didn't ask for just now (autosave, switching tabs). It never asks a question, as one
     * popping up while they type could take the next key as its answer: a file changed elsewhere only gets
     * the "couldn't save" notice, and its Try Again asks.
     */
    background?: boolean
}

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

function warnHistoryFailed(err: unknown) {
    // Only the file history failed; the file itself is saved, so the user isn't interrupted.
    console.warn("Couldn't keep a version in the file history", err)
}

/**
 * How long a save waits for the file as it is on disk to be kept in the file history, before it writes over
 * the file anyway. Reading it can hang on a network drive that went away; the save itself then says so.
 */
export const DISK_VERSION_TIMEOUT_MS = 2000

/**
 * Keeps the file on disk as a version before it is written over (lib/tauri/file-history.ts). It can't be done
 * in the app's save command: a file that can't be replaced is written in place by the page instead. Waits at
 * most DISK_VERSION_TIMEOUT_MS, and never throws: a copy that fails or takes too long only logs a warning.
 */
async function keepDiskVersionBeforeWrite(path: string, kind: DiskVersionKind): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), DISK_VERSION_TIMEOUT_MS)))
    // A read that finishes after the save gave up on it could see the new text, so it keeps nothing then.
    const late = new AbortController()
    try {
        if ((await Promise.race([keepDiskVersion(path, kind, late.signal), timeout])) === 'timeout') {
            late.abort()
            console.warn(`Keeping ${path} as it is on disk took too long, so it is saved without that copy`)
        }
    } catch (err) {
        warnHistoryFailed(err)
    } finally {
        clearTimeout(timer)
    }
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
    const fileHistoryEnabled = settings.fileHistory.enabled
    const fileHistoryEnabledRef = useRef(fileHistoryEnabled)
    // Tabs whose file on disk was kept before their first write. Keyed by the tab's disk record, which a tab
    // gets each time its file is read (opened or reloaded), so a file another program changed while it was
    // closed is kept again before Scrivon next writes it.
    const diskVersionsKept = useRef(new WeakSet<object>())
    // The same for the odd tab with no disk record, by path.
    const diskVersionsKeptByPath = useRef(new Set<string>())
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
        fileHistoryEnabledRef.current = fileHistoryEnabled
    }, [fileHistoryEnabled])

    /** True the first time it is asked about a tab's file since it was read, so its disk version is kept once. */
    const takeFirstWrite = useCallback((tab: DocumentTab): boolean => {
        if (tab.disk) {
            if (diskVersionsKept.current.has(tab.disk)) return false
            diskVersionsKept.current.add(tab.disk)
            return true
        }
        const key = comparablePath(tab.path)
        if (diskVersionsKeptByPath.current.has(key)) return false
        diskVersionsKeptByPath.current.add(key)
        return true
    }, [])

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

    const askAboutDiskChange = useCallback((fileName: string, change: DiskChange): Promise<DiskChangeChoice> => {
        openDiskQuestions.current += 1
        const answer = diskQuestion.current.then(() => confirmOverwriteDiskChange(fileName, change))
        diskQuestion.current = answer.catch(() => undefined)
        return answer.finally(() => {
            openDiskQuestions.current -= 1
        })
    }, [])

    const flushSaveRef = useRef<(id: string, options?: SaveOptions) => Promise<boolean>>(async () => true)

    // The old notice goes first, so a save that fails again gets a new one (with the new reason) that a
    // screen reader reads out, wherever Try Again was clicked.
    const retrySave = useCallback((id: string): Promise<boolean> => {
        saveErrors.current.delete(id)
        dismissNotification(saveErrorToastId(id))
        return flushSaveRef.current(id)
    }, [])

    const writeTab = useCallback(
        async (id: string, { silent = false, background = false }: SaveOptions): Promise<boolean> => {
            const tab = tabsRef.current.find((t) => t.id === id)
            if (!tab || tab.readOnly || !tab.isDirty) return true
            const disk = tab.disk
            // The file was changed elsewhere and the user hasn't saved over it: only a save they ask for asks.
            if (background && disk?.conflict) return false

            const content = tab.content
            if (!silent) {
                // Any earlier save error stays on the tab until a save actually works.
                setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: true } : t)))
            }

            try {
                // The file as it was before Scrivon first writes it this session goes in the file history, so the
                // version from before the user's edits can always be got back.
                if (fileHistoryEnabledRef.current && takeFirstWrite(tab)) await keepDiskVersionBeforeWrite(tab.path, 'before-first-write')
                let stamp: FileStamp | null
                try {
                    // Refused if the file was changed or deleted outside Scrivon since it was read or last saved.
                    stamp = await writeWorkspaceFile(tab.path, content, { format: tab.format, expected: disk ? disk.stamp : undefined })
                } catch (err) {
                    if (!(err instanceof DiskChangedError) || !disk) throw err
                    if (background) {
                        disk.conflict = err.change
                        throw err
                    }
                    const choice = await askAboutDiskChange(tab.name, err.change)
                    if (choice !== 'overwrite') disk.conflict = err.change
                    if (choice === 'keep') throw err
                    if (choice === 'reload') {
                        // The tab then shows the other version, with no edits, so there is nothing left to save (and a
                        // close waiting on this can go ahead). If it can't be read, the edits stay and so does the conflict.
                        try {
                            await coordinator.reloadTabFromDisk.current(id)
                        } catch (readErr) {
                            const why = errorMessage(readErr, '')
                            throw new Error(why ? `Couldn't reload it. ${why}` : "Couldn't reload it.")
                        }
                        return true
                    }
                    // The other program's version goes in the file history first, so overwriting it loses nothing.
                    if (fileHistoryEnabledRef.current) await keepDiskVersionBeforeWrite(tab.path, 'before-overwrite')
                    stamp = await writeWorkspaceFile(tab.path, content, { format: tab.format })
                }
                // Not waited for: the file is saved, and the history is only a copy. Its own pruning runs in the app.
                if (fileHistoryEnabledRef.current) {
                    const kind = background ? 'autosave' : 'manual'
                    void Promise.resolve()
                        .then(() => recordFileVersion(tab.path, content, kind))
                        .catch(warnHistoryFailed)
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
                        action: { label: 'Try Again', onClick: () => void retrySave(id) },
                    })
                }
                saveErrors.current.set(id, message)
                setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, isSaving: false, saveError: message } : t)))
                return false
            }
        },
        [askAboutDiskChange, clearBackup, coordinator, retrySave, setTabs, tabsRef, takeFirstWrite]
    )

    // Tabs whose file is being renamed or deleted. A save asked for meanwhile waits, then goes to wherever
    // the tab is afterwards, so it can never bring back the old file or be dropped.
    const holds = useRef(new Map<string, { whereNow: Promise<string | null>; wantsSave: boolean }>())

    const flushSave = useCallback(
        (id: string, options: SaveOptions = {}): Promise<boolean> => {
            const hold = holds.current.get(id)
            if (hold) return hold.whereNow.then((next) => (next ? flushSaveRef.current(next, options) : true))

            const timer = saveTimers.current.get(id)
            if (timer) {
                clearTimeout(timer)
                saveTimers.current.delete(id)
            }

            // Saves for one tab run one after another, so an older write can never land after a newer one.
            const previous = inFlightSaves.current.get(id)
            const run = previous ? previous.then(() => writeTab(id, options)) : writeTab(id, options)
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
                void flushSave(id, { background: true })
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
            void flushSave(id, { silent: true, background: true })
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
            retrySave,
            flushAllSaves,
            scheduleSave,
            flushSaveOnTabLeave,
        }),
        [autosaveEnabled, setAutosaveEnabled, flushSave, retrySave, flushAllSaves, scheduleSave, flushSaveOnTabLeave]
    )

    return (
        <DocumentSaveContext.Provider value={value}>
            {children}
            <DiskChangeDialog />
        </DocumentSaveContext.Provider>
    )
}
