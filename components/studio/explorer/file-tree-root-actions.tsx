'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useFileTreeActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

export function FileTreeRootActions() {
    const { workspaceRoot, refreshTree } = useWorkspaceSession()
    const { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent } = useFileTreeActions(workspaceRoot)
    // The icon spins while the folder is read, so a click that finds nothing new still shows it did something.
    const [refreshing, setRefreshing] = useState(false)

    const refresh = () => {
        setRefreshing(true)
        void refreshTree().finally(() => setRefreshing(false))
    }

    return (
        <div className="flex shrink-0 items-center gap-0.5">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh file list"
                title="Refresh file list"
                aria-busy={refreshing || undefined}
                onClick={refresh}
            >
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
            <Menu>
                <MenuTrigger
                    render={
                        <Button variant="ghost" size="icon-sm" aria-label="New file or folder" title="New file or folder">
                            <Plus className="size-4" />
                        </Button>
                    }
                />
                <MenuPopup align="end">
                    <MenuItem onClick={() => void createMermaidFileInParent()}>New Diagram (.mmd)</MenuItem>
                    <MenuItem onClick={() => void createMarkdownFileInParent()}>New Document (.md)</MenuItem>
                    <MenuItem onClick={() => void createFolderInParent()}>New Folder</MenuItem>
                </MenuPopup>
            </Menu>
        </div>
    )
}
