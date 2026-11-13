'use client'

import { Plus } from 'lucide-react'
import { useFileTreeActions } from '@/components/studio/explorer/use-file-tree-actions'
import { MenuItem } from '@/components/ui/menu'

/** New Diagram, New Document and New Folder in `folder`, for the explorer's menus. They do nothing while it is null. */
export function NewItemMenuItems({ folder }: { folder: string | null }) {
    const { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent } = useFileTreeActions(folder)

    return (
        <>
            <MenuItem onClick={() => void createMermaidFileInParent()}>
                <Plus />
                New Diagram (.mmd)
            </MenuItem>
            <MenuItem onClick={() => void createMarkdownFileInParent()}>
                <Plus />
                New Document (.md)
            </MenuItem>
            <MenuItem onClick={() => void createFolderInParent()}>
                <Plus />
                New Folder
            </MenuItem>
        </>
    )
}
