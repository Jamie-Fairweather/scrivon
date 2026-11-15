'use client'

import { documentTitleFor } from '@/components/studio/shell/use-native-window-title'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

/**
 * "● notes.md — my-folder" in the title bar's empty middle. Its own component, so typing only draws this
 * again, not the whole menu bar. Clicks pass through it to the drag area around it.
 */
export function TitleBarDocumentName() {
    const { activeTab } = useDocumentTabs()
    const { workspaceRoot } = useWorkspaceSession()
    const title = documentTitleFor(activeTab, workspaceRoot)
    if (!title) return null
    return <span className="pointer-events-none min-w-0 truncate text-xs text-muted-foreground">{title}</span>
}
