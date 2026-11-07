'use client'

import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@/lib/tauri/platform'
import { useFlushPendingSettings } from '@/components/studio/settings/settings-provider'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useWindowCloseHandler() {
    const { workspaceRoot } = useWorkspaceSession()
    const coordinator = useWorkspaceCoordinator()
    const flushPendingSettings = useFlushPendingSettings()

    useEffect(() => {
        if (!isTauri() || !workspaceRoot) return

        let disposed = false
        let unlisten: (() => void) | undefined

        void getCurrentWindow()
            .onCloseRequested(async (event) => {
                // First, before anything that can wait on the user: tells the app this page is handling the
                // close. When no answer comes (the page crashed or froze), it offers to close anyway.
                void invoke('close_ack').catch((err: unknown) => console.warn("Couldn't acknowledge the close request", err))
                // A settings change from the last moment is still waiting to be written. The window may go
                // without a pagehide, which would otherwise write it.
                flushPendingSettings()
                // Saves every tab, or asks the user what to do with changes that can't be saved
                // (Try Again / Close Without Saving / Cancel). A second click on X while this
                // is still running gets the same answer from confirmCloseTabs, so it never asks twice.
                const canClose = await coordinator.confirmCloseTabs.current()
                if (!canClose) {
                    event.preventDefault()
                    return
                }
                await coordinator.releaseAllTabs.current()
            })
            .then((fn) => {
                // The effect may have been cleaned up while the listener was still being added.
                if (disposed) fn()
                else unlisten = fn
            })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [workspaceRoot, coordinator, flushPendingSettings])
}
