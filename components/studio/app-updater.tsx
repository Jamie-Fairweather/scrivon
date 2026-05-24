'use client'

import { UpdateAvailableDialog, type AppUpdateInfo } from '@/components/studio/dialogs/update-available-dialog'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { useCallback, useEffect, useState } from 'react'

const UPDATE_CHECK_DELAY_MS = 4_000

export function AppUpdater() {
    const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
    const [installing, setInstalling] = useState(false)

    useEffect(() => {
        if (!isTauri()) return

        const timer = window.setTimeout(async () => {
            try {
                const result = await invoke<AppUpdateInfo | null>('check_for_app_update')
                if (result) setUpdate(result)
            } catch (error) {
                console.warn('Update check failed:', error)
            }
        }, UPDATE_CHECK_DELAY_MS)

        return () => window.clearTimeout(timer)
    }, [])

    const handleInstall = useCallback(async () => {
        setInstalling(true)
        try {
            await invoke('install_app_update')
            await relaunch()
        } catch (error) {
            console.error('Update install failed:', error)
            setInstalling(false)
        }
    }, [])

    if (!update) return null

    return <UpdateAvailableDialog update={update} installing={installing} onLater={() => setUpdate(null)} onInstall={handleInstall} />
}
