'use client'

import { Plus } from 'lucide-react'
import { useNamePrompt } from '@/components/studio/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'

export function FileTreeRootActions() {
    const { promptName } = useNamePrompt()
    const { workspaceRoot, createFile, createFolder } = useWorkspaceSession()

    const onNewFile = async () => {
        if (!workspaceRoot) return
        const name = await promptName('New file name', 'diagram.mmd')
        if (name) await createFile(workspaceRoot, name)
    }

    const onNewFolder = async () => {
        if (!workspaceRoot) return
        const name = await promptName('New folder name', 'diagrams')
        if (name) await createFolder(workspaceRoot, name)
    }

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
                <MenuItem onClick={() => void onNewFile()}>New File</MenuItem>
                <MenuItem onClick={() => void onNewFolder()}>New Folder</MenuItem>
            </MenuPopup>
        </Menu>
    )
}
