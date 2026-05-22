'use client'

import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@/lib/tauri/platform'
import { useDocumentSave, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useWindowCloseHandler() {
    const { workspaceRoot } = useWorkspaceSession()
    const { flushAllSaves } = useDocumentSave()

    useEffect(() => {
        if (!isTauri() || !workspaceRoot) return

        let unlisten: (() => void) | undefined

        void getCurrentWindow()
            .onCloseRequested(async (event) => {
                const ok = await flushAllSaves()
                if (!ok) {
                    event.preventDefault()
                }
            })
            .then((fn) => {
                unlisten = fn
            })

        return () => {
            unlisten?.()
        }
    }, [workspaceRoot, flushAllSaves])
}
