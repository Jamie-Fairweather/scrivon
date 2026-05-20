'use client'

import { ChevronRight, Copy, FileCode2, FileText, Folder, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useDeleteConfirm } from '@/components/studio/delete-confirm-provider'
import { useNamePrompt } from '@/components/studio/name-prompt-provider'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { isMermaidFile } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

function TreeContextMenu({ node }: { node: FileNode }) {
    const { confirmDelete } = useDeleteConfirm()
    const { promptName } = useNamePrompt()
    const { openFile, createFile, createFolder, renameEntry, deleteEntry, duplicateFile } = useWorkspace()

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

type FileTreeNodeProps = {
    node: FileNode
    depth?: number
}

export function FileTreeNode({ node, depth = 0 }: FileTreeNodeProps) {
    const { activeTabId, openFile } = useWorkspace()
    const [expanded, setExpanded] = useState(depth < 2)
    const isActive = node.kind === 'file' && node.path === activeTabId
    const isMermaid = node.kind === 'file' && isMermaidFile(node.name)

    const handleOpen = useCallback(() => {
        if (node.kind === 'file') void openFile(node.path)
        else setExpanded((e) => !e)
    }, [node, openFile])

    return (
        <div>
            <div className="group flex min-w-0 items-center pe-1" style={{ paddingLeft: `${depth * 12 + 4}px` }}>
                <button
                    type="button"
                    className={cn(
                        'flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-sidebar-accent',
                        isActive && 'bg-sidebar-accent font-medium'
                    )}
                    onClick={handleOpen}
                >
                    {node.kind === 'directory' ? (
                        <>
                            <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
                            <Folder className="size-4 shrink-0 text-muted-foreground" />
                        </>
                    ) : isMermaid ? (
                        <FileCode2 className="size-4 shrink-0 text-primary" />
                    ) : (
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-1">
                        <span className="truncate">{node.name}</span>
                        <TreeContextMenu node={node} />
                    </div>
                </button>
            </div>
            {node.kind === 'directory' && expanded && (
                <div>
                    {node.children.map((child) => (
                        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    )
}

export function FileTreeRootActions() {
    const { promptName } = useNamePrompt()
    const { workspaceRoot, createFile, createFolder } = useWorkspace()

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
