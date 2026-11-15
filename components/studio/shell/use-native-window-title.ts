'use client'

import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_NAME } from '@/lib/app-branding'
import { getBaseName } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'

type TitleTab = { name: string; isDirty: boolean }

/** "● notes.md — my-folder": the open file and folder, as the app's own title bar shows them. The dot marks unsaved changes. */
export function documentTitleFor(activeTab: TitleTab | null, workspaceRoot: string | null): string {
    const folder = workspaceRoot ? getBaseName(workspaceRoot.replace(/[/\\]+$/, '')) || workspaceRoot : null
    const file = activeTab ? `${activeTab.isDirty ? '● ' : ''}${activeTab.name}` : null
    return [file, folder].filter(Boolean).join(' — ')
}

/** "● notes.md — my-folder — Scrivon": what the taskbar and Alt+Tab show. */
export function windowTitleFor(activeTab: TitleTab | null, workspaceRoot: string | null): string {
    return [documentTitleFor(activeTab, workspaceRoot), APP_NAME].filter(Boolean).join(' — ')
}

/** Keeps the native window title (the taskbar and Alt+Tab) in step with the open file and folder. */
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
