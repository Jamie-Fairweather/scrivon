'use client'

import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeleteConfirm } from '@/components/studio/delete-confirm-provider'
import { useNamePrompt } from '@/components/studio/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import type { FileNode } from '@/lib/workspace/types'

export function FileTreeContextMenu({ node }: { node: FileNode }) {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { openFile, createFile, createFolder, renameEntry, deleteEntry, duplicateFile } = useWorkspaceSession()

    const handleNewFile = async () => {
        if (node.kind !== 'directory') return
        const name = await promptName('New file name', 'diagram.mmd')
        if (name) await createFile(node.path, name)
    }

    const handleNewFolder = async () => {
        if (node.kind !== 'directory') return
        const name = await promptName('New folder name', 'diagrams')
        if (name) await createFolder(node.path, name)
    }

    const handleRename = async () => {
        const name = await promptName('Rename', node.name)
        if (name && name !== node.name) await renameEntry(node.path, name)
    }

    const handleDelete = async () => {
        const ok = await confirmDelete(node.name, node.kind === 'directory')
        if (ok) await deleteEntry(node.path, node.kind === 'directory')
    }

    return (
        <Menu>
            <MenuTrigger
                nativeButton={false}
                render={
                    <Button
                        render={<span />}
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-label="File actions"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <MoreHorizontal className="size-3.5" />
                    </Button>
                }
            />
            <MenuPopup align="start" className="min-w-44">
                {node.kind === 'file' ? (
                    <>
                        <MenuItem onClick={() => void openFile(node.path)}>Open</MenuItem>
                        <MenuItem onClick={() => void handleRename()}>
                            <Pencil />
                            Rename
                        </MenuItem>
                        <MenuItem onClick={() => void duplicateFile(node.path)}>
                            <Copy />
                            Duplicate
                        </MenuItem>
                        <MenuItem variant="destructive" onClick={() => void handleDelete()}>
                            <Trash2 />
                            Delete
                        </MenuItem>
                    </>
                ) : (
                    <>
                        <MenuItem onClick={() => void handleNewFile()}>
                            <Plus />
                            New File
                        </MenuItem>
                        <MenuItem onClick={() => void handleNewFolder()}>
                            <Plus />
                            New Folder
                        </MenuItem>
                        <MenuItem onClick={() => void handleRename()}>
                            <Pencil />
                            Rename
                        </MenuItem>
                        <MenuItem variant="destructive" onClick={() => void handleDelete()}>
                            <Trash2 />
                            Delete
                        </MenuItem>
                    </>
                )}
            </MenuPopup>
        </Menu>
    )
}
