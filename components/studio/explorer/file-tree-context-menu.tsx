'use client'

import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useDeleteConfirm } from '@/components/studio/dialogs/delete-confirm-provider'
import { useFileTreeActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { getParentPath, isSupportedDocument } from '@/lib/tauri/fs'
import { documentExtension, withDocumentExtension } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

function FileTreeMenuItems({ node }: { node: FileNode }) {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { openFile, renameEntry, deleteEntry, duplicateFile, getNameError } = useWorkspaceSession()
    const parentPath = node.kind === 'directory' ? node.path : null
    const { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent } = useFileTreeActions(parentPath)

    const handleRename = async () => {
        const folder = getParentPath(node.path)
        // A file renamed without an extension keeps its current one ('notes.md' -> 'meeting' -> 'meeting.md').
        const extension = node.kind === 'file' ? documentExtension(node.name) : null
        const finalName = (value: string) => (extension ? withDocumentExtension(value, extension) : value)
        const name = await promptName({
            title: 'Rename',
            defaultValue: node.name,
            placeholder: node.name,
            validate: (value) => getNameError(folder, finalName(value), node.kind, node.path),
        })
        if (!name) return
        const newName = finalName(name)
        if (newName !== node.name) await renameEntry(node.path, newName, node.kind === 'directory')
    }

    const handleDelete = async () => {
        const ok = await confirmDelete(node.name, node.kind === 'directory')
        if (ok) await deleteEntry(node.path, node.kind === 'directory')
    }

    if (node.kind === 'file') {
        return (
            <>
                <MenuItem disabled={!isSupportedDocument(node.name)} onClick={() => void openFile(node.path)}>
                    Open
                </MenuItem>
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
        )
    }

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
            <MenuItem onClick={() => void handleRename()}>
                <Pencil />
                Rename
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => void handleDelete()}>
                <Trash2 />
                Delete
            </MenuItem>
        </>
    )
}

export function FileTreeContextMenu({ node }: { node: FileNode }) {
    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        // Shown on hover, when the row has keyboard focus, and while its own menu is open.
                        className="size-6 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100
                            data-popup-open:opacity-100"
                        aria-label={`Actions for ${node.name}`}
                    >
                        <MoreHorizontal className="size-3.5" />
                    </Button>
                }
            />
            <MenuPopup align="start" className="min-w-44">
                <FileTreeMenuItems node={node} />
            </MenuPopup>
        </Menu>
    )
}

export function FileTreeRowContextMenu({ node, children }: { node: FileNode; children: React.ReactNode }) {
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            // React also delivers right-clicks from this row's open menus (they render in a portal); leave those alone.
            if (!e.currentTarget.contains(e.target as Node)) return
            e.preventDefault()
            e.stopPropagation()
            openAt({ x: e.clientX, y: e.clientY })
        },
        [openAt]
    )

    return (
        <span onContextMenu={onContextMenu} className="contents">
            {children}
            <ContextMenuAtPoint open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" className="min-w-44">
                <FileTreeMenuItems node={node} />
            </ContextMenuAtPoint>
        </span>
    )
}
