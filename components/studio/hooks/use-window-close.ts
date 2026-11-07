'use client'

import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@/lib/tauri/platform'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useWindowCloseHandler() {
    const { workspaceRoot } = useWorkspaceSession()
    const coordinator = useWorkspaceCoordinator()

    useEffect(() => {
        if (!isTauri() || !workspaceRoot) return

        let disposed = false
        let unlisten: (() => void) | undefined

        void getCurrentWindow()
            .onCloseRequested(async (event) => {
                // Saves every tab, or asks the user what to do with changes that can't be saved
                // (Try Again / Close Without Saving / Cancel). A second click on X while this
                // is still running is turned away by confirmCloseTabs, so it never runs twice.
                const canClose = await coordinator.confirmCloseTabs.current()
                if (!canClose) event.preventDefault()
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
    }, [workspaceRoot, coordinator])
}
