'use client'

import { useCallback } from 'react'
import { MenuItem } from '@/components/ui/menu'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'

export function EditorTabRowContextMenu({ tabId, children }: { tabId: string; children: React.ReactNode }) {
    const { tabs, setActiveTab, closeTab, closeOtherTabs, closeAllTabs } = useDocumentTabs()
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            void setActiveTab(tabId)
            openAt({ x: e.clientX, y: e.clientY })
        },
        [openAt, setActiveTab, tabId]
    )

    const canCloseOthers = tabs.length > 1

    return (
        <span onContextMenu={onContextMenu} className="contents">
            {children}
            <ContextMenuAtPoint open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" className="min-w-44">
                <MenuItem onClick={() => void closeTab(tabId)}>Close</MenuItem>
                <MenuItem disabled={!canCloseOthers} onClick={() => void closeOtherTabs(tabId)}>
                    Close Others
                </MenuItem>
                <MenuItem disabled={tabs.length === 0} onClick={() => void closeAllTabs()}>
                    Close All
                </MenuItem>
            </ContextMenuAtPoint>
        </span>
    )
}
