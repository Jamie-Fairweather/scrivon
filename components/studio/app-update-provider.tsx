'use client'

import { reportLastUpdateAttempt } from '@/lib/updater/update-attempt'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { shareUpdateCheck } from '@/components/studio/shared-update-check'
import {
    UpdateAvailableDialog,
    type AppUpdateInfo,
    type DownloadProgress,
    type InstallPhase,
} from '@/components/studio/dialogs/update-available-dialog'
import { useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { dismissNotification, errorMessage, notifyError, notifyInfo, notifySuccess } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchUpdateReleaseNotes } from '@/lib/updater/release-notes'
import { checkForAppUpdate } from '@/lib/updater/update-check'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { getVersion } from '@tauri-apps/api/app'
import { Channel, invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000
/** While automatic checks are on, a long session checks again this often. */
const UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** What install_app_update says while it works (UpdateProgress in src-tauri/src/updater.rs). */
export type UpdateProgress =
    { event: 'started'; total: number | null } | { event: 'progress'; downloaded: number; total: number | null } | { event: 'installing' }

/** One toast for a check the user asked for: "Checking…", then the answer in its place. */
const UPDATE_CHECK_TOAST_ID = 'app-update-check'
const MISSED_PRERELEASES = "Couldn't get the newest pre-release from GitHub. Try again later."

/**
 * What one update check found. `isNew` is false for the version an earlier check already found.
 * `missedPrereleases` means an rc build only checked stable releases (see checkForAppUpdate).
 */
type CheckOutcome =
    | { status: 'available'; update: AppUpdateInfo; isNew: boolean }
    | { status: 'up-to-date'; currentVersion: string | null; missedPrereleases: boolean }
    | { status: 'failed'; error: unknown }

type AppUpdateContextValue = {
    update: AppUpdateInfo | null
    notesLoading: boolean
    /** True while a check the user asked for runs (not the quiet automatic ones). */
    checking: boolean
    /** Checks now, then opens the update dialog or says the app is up to date or couldn't check. */
    checkForUpdates: () => Promise<void>
    /** What Install is doing: nothing yet, saving the open files (or asking about them), downloading or installing. */
    installPhase: InstallPhase
    /** How much of the update has downloaded, once the download has started. */
    download: DownloadProgress | null
    /** Why the last Install failed, until the next try. */
    installError: string | null
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
    const { settings, flushPendingSettings, closeSettings } = useAppSettings()
    const coordinator = useWorkspaceCoordinator()
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [notesLoading, setNotesLoading] = useState(false)
    const [checking, setChecking] = useState(false)
    const [installPhase, setInstallPhase] = useState<InstallPhase>('idle')
    const [download, setDownload] = useState<DownloadProgress | null>(null)
    const [installError, setInstallError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    // Set straight away, so a second press while the first is still saving does nothing.
    const installRunning = useRef(false)
    // The version found so far, and the check that is running, for checks that overlap.
    const foundVersion = useRef<string | null>(null)
    const runningCheck = useRef<Promise<CheckOutcome> | null>(null)

    // The installer runs after the app has closed, so say on the next launch how it went.
    useEffect(() => {
        void reportLastUpdateAttempt()
    }, [])

    /** Runs one update check; a call while one runs gets that check's result. */
    const runCheck = useCallback((): Promise<CheckOutcome> => {
        runningCheck.current ??= (async (): Promise<CheckOutcome> => {
            try {
                const currentVersion = await getVersion().catch(() => null)
                const { update: found, missedPrereleases } = await checkForAppUpdate(currentVersion)
                if (!found) return { status: 'up-to-date', currentVersion, missedPrereleases }
                if (found.version === foundVersion.current) return { status: 'available', update: found, isNew: false }

                foundVersion.current = found.version
                setUpdate(found)
                // The manifest only has notes for the new version, so also fetch every version in between for
                // someone skipping releases; the manifest notes show until that arrives. This finishes even if
                // automatic checks are switched off meanwhile (that only stops new checks).
                setNotesLoading(true)
                void fetchUpdateReleaseNotes(found, currentVersion)
                    .then((notes) => {
                        if (notes) setUpdate((current) => (current?.version === found.version ? { ...current, notes } : current))
                    })
                    .finally(() => setNotesLoading(false))
                return { status: 'available', update: found, isNew: true }
            } catch (error) {
                return { status: 'failed', error }
            } finally {
                runningCheck.current = null
            }
        })()
        return runningCheck.current
    }, [])

    // Shortly after launch, then every few hours for a long session. A new version shows a toast.
    useEffect(() => {
        if (!isTauri() || !settings.updates.checkOnLaunch) return

        const check = async () => {
            // The dialog shows the update being installed; leave it as it is.
            if (installRunning.current) return
            const outcome = await runCheck()
            if (outcome.status === 'failed') console.warn('Update check failed:', outcome.error)
            else if (outcome.status === 'available' && outcome.isNew) showUpdateAvailableToast(outcome.update.version, () => setDialogOpen(true))
        }
        const first = window.setTimeout(check, UPDATE_CHECK_DELAY_MS)
        const again = window.setInterval(check, UPDATE_RECHECK_INTERVAL_MS)
        return () => {
            window.clearTimeout(first)
            window.clearInterval(again)
        }
    }, [settings.updates.checkOnLaunch, runCheck])

    const checkForUpdates = useCallback(async () => {
        setChecking(true)
        // The answer can take a while on a slow connection.
        notifyInfo('Checking for updates…', { id: UPDATE_CHECK_TOAST_ID, timeout: 0 })
        try {
            const outcome = await runCheck()
            if (outcome.status === 'available') {
                dismissNotification(UPDATE_CHECK_TOAST_ID)
                // Settings (where the check may have come from) is a dialog of its own, so close it rather
                // than open one dialog over another.
                closeSettings()
                setDialogOpen(true)
            } else if (outcome.status === 'failed') {
                notifyError("Couldn't check for updates", outcome.error, { id: UPDATE_CHECK_TOAST_ID })
            } else if (outcome.missedPrereleases) {
                // Only stable releases were checked, so a newer rc may be out there.
                notifyError("Couldn't check for updates", MISSED_PRERELEASES, { id: UPDATE_CHECK_TOAST_ID })
            } else {
                notifySuccess("You're up to date", {
                    id: UPDATE_CHECK_TOAST_ID,
                    description: outcome.currentVersion ? `Version ${outcome.currentVersion} is the newest version.` : undefined,
                })
            }
        } finally {
            setChecking(false)
        }
    }, [runCheck, closeSettings])

    // Settings has a Check now button, but sits outside this provider (see shared-update-check).
    useEffect(() => {
        shareUpdateCheck({ check: checkForUpdates, checking })
        return () => shareUpdateCheck(null)
    }, [checkForUpdates, checking])

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
        setInstallError(null)
    }, [installPhase])

    const installUpdate = useCallback(async () => {
        if (installRunning.current) return
        installRunning.current = true
        setInstallError(null)
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
                // A settings change from the last moment is still waiting to be written, and nothing
                // runs once the installer has ended the app.
                flushPendingSettings()
                await invoke('install_app_update', { onProgress })
                await relaunch()
            } catch (error) {
                // Shown in the update dialog, which stays open.
                console.error("Couldn't install the update", error)
                setInstallError(errorMessage(error))
                setInstallPhase('idle')
                setDownload(null)
                // The app stays open with its tabs, so their unsaved edits get their safety copies back.
                coordinator.backUpUnsavedTabs.current()
            }
        } finally {
            installRunning.current = false
        }
    }, [coordinator, flushPendingSettings])

    const value = useMemo(
        () => ({
            update,
            notesLoading,
            checking,
            checkForUpdates,
            installPhase,
            download,
            installError,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        }),
        [
            update,
            notesLoading,
            checking,
            checkForUpdates,
            installPhase,
            download,
            installError,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        ]
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
                    error={installError}
                    onLater={dismissUpdateDialog}
                    onInstall={() => void installUpdate()}
                />
            ) : null}
        </AppUpdateContext.Provider>
    )
}
