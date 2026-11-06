'use client'

import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { UpdateAvailableDialog, type AppUpdateInfo } from '@/components/studio/dialogs/update-available-dialog'
import { useDocumentSave, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { fetchReleaseNotes } from '@/lib/updater/release-notes'
import { showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000

export type InstallUpdateOptions = {
    /** Install even though some open files could not be saved (their unsaved changes are lost). */
    ignoreSaveErrors?: boolean
}

type AppUpdateContextValue = {
    update: AppUpdateInfo | null
    notesLoading: boolean
    installing: boolean
    /** True after an install attempt stopped because some open files could not be saved. */
    saveFailed: boolean
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
    const coordinator = useWorkspaceCoordinator()
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [notesLoading, setNotesLoading] = useState(false)
    const [installing, setInstalling] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)

    useEffect(() => {
        if (!isTauri() || !settings.updates.checkOnLaunch) return

        let cancelled = false

        const timer = window.setTimeout(async () => {
            try {
                const result = await invoke<AppUpdateInfo | null>('check_for_app_update')
                if (!result || cancelled) return

                setUpdate(result)
                showUpdateAvailableToast(result.version, () => setDialogOpen(true))

                if (result.notes?.trim()) return

                // The update is already found and shown, so finish loading its notes even if the
                // "check on launch" setting is switched off meanwhile (that only stops new checks).
                setNotesLoading(true)
                const notes = await fetchReleaseNotes(result.version)
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

    const openUpdateDialog = useCallback(() => {
        if (update) setDialogOpen(true)
    }, [update])

    const dismissUpdateDialog = useCallback(() => {
        if (installing) return
        setSaveFailed(false)
        setDialogOpen(false)
    }, [installing])

    const installUpdate = useCallback(
        async ({ ignoreSaveErrors = false }: InstallUpdateOptions = {}) => {
            setInstalling(true)
            setSaveFailed(false)

            // The installer ends the process straight away (on Windows it exits before relaunch() runs),
            // so the save-on-close handler never fires. Save open files first, the same way closing does.
            if (!ignoreSaveErrors) {
                const saved = await flushAllSaves().catch(() => false)
                if (!saved) {
                    setSaveFailed(true)
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
            saveFailed,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        }),
        [update, notesLoading, installing, saveFailed, dialogOpen, openUpdateDialog, dismissUpdateDialog, installUpdate]
    )

    return (
        <AppUpdateContext.Provider value={value}>
            {children}
            {update && dialogOpen ? (
                <UpdateAvailableDialog
                    update={update}
                    notesLoading={notesLoading}
                    installing={installing}
                    saveFailed={saveFailed}
                    onLater={dismissUpdateDialog}
                    onInstall={() => void installUpdate()}
                    onInstallAnyway={() => void installUpdate({ ignoreSaveErrors: true })}
                />
            ) : null}
        </AppUpdateContext.Provider>
    )
}
