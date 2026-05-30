'use client'

import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { UpdateAvailableDialog, type AppUpdateInfo } from '@/components/studio/dialogs/update-available-dialog'
import { fetchReleaseNotes } from '@/lib/updater/release-notes'
import { showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000

type AppUpdateContextValue = {
    update: AppUpdateInfo | null
    notesLoading: boolean
    installing: boolean
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
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [notesLoading, setNotesLoading] = useState(false)
    const [installing, setInstalling] = useState(false)
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

                setNotesLoading(true)
                const notes = await fetchReleaseNotes(result.version)
                if (cancelled) return

                if (notes) {
                    setUpdate((current) => (current ? { ...current, notes } : null))
                }
            } catch (error) {
                console.warn('Update check failed:', error)
            } finally {
                if (!cancelled) setNotesLoading(false)
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
        if (!installing) setDialogOpen(false)
    }, [installing])

    const installUpdate = useCallback(async () => {
        setInstalling(true)
        try {
            await invoke('install_app_update')
            await relaunch()
        } catch (error) {
            console.error('Update install failed:', error)
            setInstalling(false)
        }
    }, [])

    const value = useMemo(
        () => ({
            update,
            notesLoading,
            installing,
            dialogOpen,
            openUpdateDialog,
            dismissUpdateDialog,
            installUpdate,
        }),
        [update, notesLoading, installing, dialogOpen, openUpdateDialog, dismissUpdateDialog, installUpdate]
    )

    return (
        <AppUpdateContext.Provider value={value}>
            {children}
            {update && dialogOpen ? (
                <UpdateAvailableDialog
                    update={update}
                    notesLoading={notesLoading}
                    installing={installing}
                    onLater={dismissUpdateDialog}
                    onInstall={() => void installUpdate()}
                />
            ) : null}
        </AppUpdateContext.Provider>
    )
}
