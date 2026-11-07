'use client'

import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_NAME } from '@/lib/app-branding'
import { getBaseName } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'

/** "● notes.md — my-folder — Scrivon": what the taskbar and Alt+Tab show. The dot marks unsaved changes. */
export function windowTitleFor(activeTab: { name: string; isDirty: boolean } | null, workspaceRoot: string | null): string {
    const folder = workspaceRoot ? getBaseName(workspaceRoot.replace(/[/\\]+$/, '')) || workspaceRoot : null
    const file = activeTab ? `${activeTab.isDirty ? '● ' : ''}${activeTab.name}` : null
    return [file, folder, APP_NAME].filter(Boolean).join(' — ')
}

/** Keeps the native window title in step with the open file and folder (the custom title bar doesn't show it). */
export function useNativeWindowTitle(): void {
    const { activeTab } = useDocumentTabs()
    const { workspaceRoot } = useWorkspaceSession()
    const title = windowTitleFor(activeTab, workspaceRoot)

    useEffect(() => {
        if (!isTauri()) return
        getCurrentWindow()
            .setTitle(title)
            .catch((error: unknown) => console.warn('Could not set the window title:', error))
    }, [title])
}

/** Renders nothing; a separate component so tab changes don't re-render the whole shell. */
export function NativeWindowTitle(): null {
    useNativeWindowTitle()
    return null
}
