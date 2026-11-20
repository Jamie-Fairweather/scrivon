'use client'

import { FilePlus, Plus } from 'lucide-react'
import { NEW_FROM_TEMPLATE, NEW_ITEMS } from '@/components/studio/explorer/new-item-commands'
import { useFileTreeActions, type NewItemKind } from '@/components/studio/explorer/use-file-tree-actions'
import { MenuItem } from '@/components/ui/menu'

/**
 * New Diagram, New Document, New Folder and New from Template in `folder`, for the explorer's menus, with the
 * palette's names. They do nothing while it is null.
 */
export function NewItemMenuItems({ folder }: { folder: string | null }) {
    const { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent, createFromTemplateInParent } = useFileTreeActions(folder)
    const create: Record<NewItemKind, () => Promise<void>> = {
        'new-diagram': createMermaidFileInParent,
        'new-document': createMarkdownFileInParent,
        'new-folder': createFolderInParent,
    }

    return (
        <>
            {NEW_ITEMS.map(({ kind, label }) => (
                <MenuItem key={kind} onClick={() => void create[kind]()}>
                    <Plus />
                    {label}
                </MenuItem>
            ))}
            <MenuItem onClick={() => void createFromTemplateInParent()}>
                <FilePlus />
                {NEW_FROM_TEMPLATE.label}
            </MenuItem>
        </>
    )
}
