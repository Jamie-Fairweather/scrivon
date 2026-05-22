'use client'

import { Plus } from 'lucide-react'
import { useFileTreeActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'

export function FileTreeRootActions() {
    const { workspaceRoot } = useWorkspaceSession()
    const { createFileInParent, createFolderInParent } = useFileTreeActions(workspaceRoot)

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button variant="ghost" size="icon-sm" aria-label="New">
                        <Plus className="size-4" />
                    </Button>
                }
            />
            <MenuPopup align="end">
                <MenuItem onClick={() => void createFileInParent()}>New File</MenuItem>
                <MenuItem onClick={() => void createFolderInParent()}>New Folder</MenuItem>
            </MenuPopup>
        </Menu>
    )
}
