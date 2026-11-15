'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { NewItemMenuItems } from '@/components/studio/explorer/new-item-menu-items'
import { useRefreshExplorer } from '@/components/studio/workspace/workspace-commands'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

export function FileTreeRootActions() {
    const { workspaceRoot } = useWorkspaceSession()
    const refreshExplorer = useRefreshExplorer()
    // The icon spins while the folder is read, so a click that finds nothing new still shows it did something.
    const [refreshing, setRefreshing] = useState(false)

    const refresh = () => {
        setRefreshing(true)
        void refreshExplorer().finally(() => setRefreshing(false))
    }

    return (
        <div className="flex shrink-0 items-center gap-0.5">
            <IconTooltip label="Refresh file list">
                <Button variant="ghost" size="icon-sm" aria-label="Refresh file list" aria-busy={refreshing || undefined} onClick={refresh}>
                    <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                </Button>
            </IconTooltip>
            <Menu>
                {/* The tooltip's trigger renders the menu's trigger, which renders the button, so both work on one button. */}
                <IconTooltip label="New file or folder">
                    <MenuTrigger
                        render={
                            <Button variant="ghost" size="icon-sm" aria-label="New file or folder">
                                <Plus className="size-4" />
                            </Button>
                        }
                    />
                </IconTooltip>
                <MenuPopup align="end">
                    <NewItemMenuItems folder={workspaceRoot} />
                </MenuPopup>
            </Menu>
        </div>
    )
}
