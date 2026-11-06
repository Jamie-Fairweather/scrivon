'use client'

import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { UpdateAvailableDialog, type AppUpdateInfo, type InstallBlocker } from '@/components/studio/dialogs/update-available-dialog'
import { useDocumentSave, useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000

/** How long installing waits for open files to save (e.g. an offline network drive) before treating it as failed. */
export const SAVE_BEFORE_INSTALL_TIMEOUT_MS = 10_000

export type InstallUpdateOptions = {
    /**
     * Edited files: 'ask' (default) stops to ask first when autosave is off, 'save' saves them,
     * 'discard' installs without saving them (their unsaved changes are lost).
     */
    unsaved?: 'ask' | 'save' | 'discard'
}

function savedWithin(save: Promise<boolean>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
    })
    return Promise.race([save.catch(() => false), timeout]).finally(() => clearTimeout(timer))
}

type AppUpdateContextValue = {
    update: AppUpdateInfo | null
    notesLoading: boolean
    installing: boolean
    /** Set when an install attempt stopped to ask what to do with open files. */
    installBlocker: InstallBlocker | null
    dialogOpen: boolean
    openUpdateDialog: () => void
    dismissUpdateDialog: () => void
    installUpdate: (options?: InstallUpdateOptions) => Promise<void>
}

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null)

export function useAppUpdate(): AppUpdateContextValue {
    const ctx = useContext(AppUpdateContext)
    if (!ctx) {
        throw new Error('useAppUpdate must be used within AppUpdateProvider')
    }
    return ctx
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
    const { settings } = useAppSettings()
    const { flushAllSaves } = useDocumentSave()
    const { tabs } = useDocumentTabs()
    const coordinator = useWorkspaceCoordinator()
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [notesLoading, setNotesLoading] = useState(false)
    const [installing, setInstalling] = useState(false)
    const [installBlocker, setInstallBlocker] = useState<InstallBlocker | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    // Read when Install is pressed; a ref so typing doesn't recreate installUpdate.
    const tabsRef = useRef(tabs)

    useEffect(() => {
        tabsRef.current = tabs
    }, [tabs])

    useEffect(() => {
        if (!isTauri() || !settings.updates.checkOnLaunch) return

        let cancelled = false

        const timer = window.setTimeout(async () => {
            try {
                const result = await invoke<AppUpdateInfo | null>('check_for_app_update')
                if (!result || cancelled) return

                setUpdate(result)
                showUpdateAvailableToast(result.version, () => setDialogOpen(true))

                // The update is already found and shown, so finish loading its notes even if the
                // "check on launch" setting is switched off meanwhile (that only stops new checks).
                // The manifest only has notes for the new version, so also fetch every version in
                // between for someone skipping releases; the manifest notes show until that arrives.
                setNotesLoading(true)
                const currentVersion = await getVersion().catch(() => null)
                const notes = await fetchUpdateReleaseNotes(result, currentVersion)
                if (notes) {
                    setUpdate((current) => (current ? { ...current, notes } : null))
                }
            } catch (error) {
                console.warn('Update check failed:', error)
            } finally {
                setNotesLoading(false)
            }
        }, UPDATE_CHECK_DELAY_MS)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [settings.updates.checkOnLaunch])

    // The toast never times out, so close it once the dialog is open (from the toast or the
    // menu-bar button); otherwise it floats over the dialog for the rest of the session.
    useEffect(() => {
        if (dialogOpen) dismissUpdateToast()
    }, [dialogOpen])

    const openUpdateDialog = useCallback(() => {
        if (update) setDialogOpen(true)
    }, [update])

    const dismissUpdateDialog = useCallback(() => {
        if (installing) return
        setInstallBlocker(null)
        setDialogOpen(false)
    }, [installing])

    const installUpdate = useCallback(
        async ({ unsaved = 'ask' }: InstallUpdateOptions = {}) => {
            setInstallBlocker(null)

            // With autosave off the user saves by hand, so don't write their edits to disk without asking.
            if (unsaved === 'ask' && !coordinator.getAutosaveEnabled.current()) {
                const fileNames = tabsRef.current.filter((t) => t.isDirty && !t.readOnly).map((t) => t.name)
                if (fileNames.length > 0) {
                    setInstallBlocker({ reason: 'unsaved', fileNames })
                    return
                }
            }

            setInstalling(true)

            // The installer ends the process straight away (on Windows it exits before relaunch() runs),
            // so the save-on-close handler never fires. Save open files first, the same way closing does.
            // A save that hangs counts as failed, so the dialog never stays stuck on "Installing…".
            if (unsaved !== 'discard') {
                const saved = await savedWithin(flushAllSaves(), SAVE_BEFORE_INSTALL_TIMEOUT_MS)
                if (!saved) {
                    setInstallBlocker({ reason: 'save-failed' })
                    setInstalling(false)
                    return
                }
            }

            try {
                await coordinator.persistWorkspaceTabSession.current()
            } catch (error) {
                console.warn('Could not save open tabs before updating:', error)
            }

            try {
                await invoke('install_app_update')
                await relaunch()
            } catch (error) {
                notifyError("Couldn't install the update", error)
                setInstalling(false)
            }
        },
        [coordinator, flushAllSaves]
    )

    const value = useMemo(
        () => ({
            update,
            notesLoading,
            installing,
            installBlocker,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        }),
        [update, notesLoading, installing, installBlocker, dialogOpen, openUpdateDialog, dismissUpdateDialog, installUpdate]
    )

    return (
        <AppUpdateContext.Provider value={value}>
            {children}
            {update && dialogOpen ? (
                <UpdateAvailableDialog
                    update={update}
                    notesLoading={notesLoading}
                    installing={installing}
                    blocker={installBlocker}
                    onLater={dismissUpdateDialog}
                    onInstall={() => void installUpdate()}
                    onSaveAndInstall={() => void installUpdate({ unsaved: 'save' })}
                    onInstallWithoutSaving={() => void installUpdate({ unsaved: 'discard' })}
                />
            ) : null}
        </AppUpdateContext.Provider>
    )
}
