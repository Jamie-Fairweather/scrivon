'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { NewItemMenuItems } from '@/components/studio/explorer/new-item-menu-items'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { useRefreshExplorer } from '@/components/studio/workspace/workspace-commands'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { MenuItem, MenuSeparator } from '@/components/ui/menu'

/**
 * The menu for a right-click on empty space in the file list: new items at the top of the open folder, and
 * Refresh. Rows have menus of their own.
 */
export function ExplorerBackgroundMenu({ children }: { children: ReactNode }) {
    const { workspaceRoot } = useWorkspaceSession()
    const refresh = useRefreshExplorer()
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            // A right-click inside an open menu (drawn elsewhere on the page) arrives here too; leave it alone.
            if (!e.currentTarget.contains(e.target as Node)) return
            e.preventDefault()
            openAt({ x: e.clientX, y: e.clientY })
        },
        [openAt]
    )

    return (
        <div onContextMenu={onContextMenu} className="flex min-h-0 flex-1 flex-col">
            {children}
            <ContextMenuAtPoint open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" className="min-w-44">
                <NewItemMenuItems folder={workspaceRoot} />
                <MenuSeparator />
                <MenuItem onClick={() => void refresh()}>
                    <RefreshCw />
                    Refresh
                </MenuItem>
            </ContextMenuAtPoint>
        </div>
    )
}
