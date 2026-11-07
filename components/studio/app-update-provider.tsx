'use client'

import { reportLastUpdateAttempt } from '@/lib/updater/update-attempt'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    UpdateAvailableDialog,
    type AppUpdateInfo,
    type DownloadProgress,
    type InstallPhase,
} from '@/components/studio/dialogs/update-available-dialog'
import { useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { getVersion } from '@tauri-apps/api/app'
import { Channel, invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000

/** What install_app_update says while it works (UpdateProgress in src-tauri/src/updater.rs). */
export type UpdateProgress =
    | { event: 'started'; total: number | null }
    | { event: 'progress'; downloaded: number; total: number | null }
    | { event: 'installing' }

type AppUpdateContextValue = {
    update: AppUpdateInfo | null
    notesLoading: boolean
    /** What Install is doing: nothing yet, saving the open files (or asking about them), downloading or installing. */
    installPhase: InstallPhase
    /** How much of the update has downloaded, once the download has started. */
    download: DownloadProgress | null
    dialogOpen: boolean
    openUpdateDialog: () => void
    dismissUpdateDialog: () => void
    installUpdate: () => Promise<void>
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
    const coordinator = useWorkspaceCoordinator()
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [notesLoading, setNotesLoading] = useState(false)
    const [installPhase, setInstallPhase] = useState<InstallPhase>('idle')
    const [download, setDownload] = useState<DownloadProgress | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    // Set straight away, so a second press while the first is still saving does nothing.
    const installRunning = useRef(false)

    // The installer runs after the app has closed, so say on the next launch how it went.
    useEffect(() => {
        void reportLastUpdateAttempt()
    }, [])

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
        if (installPhase !== 'idle') return
        setDialogOpen(false)
    }, [installPhase])

    const installUpdate = useCallback(async () => {
        if (installRunning.current) return
        installRunning.current = true
        try {
            // The installer ends the app straight away (on Windows before relaunch() runs), so open files are
            // dealt with first, exactly as closing the window does: saved, or the user is asked about them (with
            // autosave off, or when a save fails). Cancel there stops the install.
            setInstallPhase('saving')
            if (!(await coordinator.confirmCloseTabs.current())) {
                setInstallPhase('idle')
                return
            }
            // The copies of edits that were saved, or that the user chose not to keep, go now, so the next launch
            // doesn't offer them back.
            await coordinator.releaseAllTabs.current()
            try {
                await coordinator.persistWorkspaceTabSession.current()
            } catch (error) {
                console.warn('Could not save open tabs before updating:', error)
            }

            setInstallPhase('downloading')
            setDownload(null)
            const onProgress = new Channel<UpdateProgress>()
            onProgress.onmessage = (message) => {
                if (message.event === 'installing') setInstallPhase('installing')
                else setDownload({ downloaded: message.event === 'progress' ? message.downloaded : 0, total: message.total })
            }
            try {
                await invoke('install_app_update', { onProgress })
                await relaunch()
            } catch (error) {
                notifyError("Couldn't install the update", error)
                setInstallPhase('idle')
                setDownload(null)
                // The app stays open with its tabs, so their unsaved edits get their safety copies back.
                coordinator.backUpUnsavedTabs.current()
            }
        } finally {
            installRunning.current = false
        }
    }, [coordinator])

    const value = useMemo(
        () => ({
            update,
            notesLoading,
            installPhase,
            download,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        }),
        [update, notesLoading, installPhase, download, dialogOpen, openUpdateDialog, dismissUpdateDialog, installUpdate]
    )

    return (
        <AppUpdateContext.Provider value={value}>
            {children}
            {update && dialogOpen ? (
                <UpdateAvailableDialog
                    update={update}
                    notesLoading={notesLoading}
                    phase={installPhase}
                    download={download}
                    onLater={dismissUpdateDialog}
                    onInstall={() => void installUpdate()}
                />
            ) : null}
        </AppUpdateContext.Provider>
    )
}
