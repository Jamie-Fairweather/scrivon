'use client'

import { ChevronRight, FileCode2, FileText, Folder } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FileTreeContextMenu } from '@/components/studio/explorer/file-tree-context-menu'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { isMermaidFile } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

type FileTreeNodeProps = {
    node: FileNode
    depth?: number
}

export function FileTreeNode({ node, depth = 0 }: FileTreeNodeProps) {
    const { activeTabId, openFile } = useDocumentTabs()
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
                        <FileTreeContextMenu node={node} />
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
