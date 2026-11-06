'use client'

import { ChevronRight, FileCode2, FileText, Folder } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FileTreeContextMenu, FileTreeRowContextMenu } from '@/components/studio/explorer/file-tree-context-menu'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { isMarkdownFile, isMermaidFile, isSupportedDocument } from '@/lib/tauri/fs'
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
    const isMarkdown = node.kind === 'file' && isMarkdownFile(node.name)
    const isUnsupported = node.kind === 'file' && !isSupportedDocument(node.name)

    const handleOpen = useCallback(() => {
        if (node.kind === 'file') {
            if (!isSupportedDocument(node.name)) return
            void openFile(node.path)
        } else setExpanded((e) => !e)
    }, [node, openFile])

    return (
        <div>
            <FileTreeRowContextMenu node={node}>
                {/* The actions button sits beside the row button, not inside it, so its menu clicks never reach the row. */}
                <div
                    className={cn(
                        'group me-1 flex min-w-0 items-center rounded-md hover:bg-sidebar-accent',
                        isActive && 'bg-sidebar-accent',
                        isUnsupported && 'hover:bg-transparent'
                    )}
                    style={{ marginLeft: `${depth * 12 + 4}px` }}
                >
                    <button
                        type="button"
                        className={cn(
                            'flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-sm',
                            isActive && 'font-medium',
                            isUnsupported && 'text-muted-foreground/60'
                        )}
                        title={isUnsupported ? 'Scrivon supports .md and .mmd files only' : undefined}
                        onClick={handleOpen}
                    >
                        {node.kind === 'directory' ? (
                            <>
                                <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
                                <Folder className="size-4 shrink-0 text-muted-foreground" />
                            </>
                        ) : isMermaid ? (
                            <FileCode2 className="size-4 shrink-0 text-primary" />
                        ) : isMarkdown ? (
                            <FileText className="size-4 shrink-0 text-primary" />
                        ) : (
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{node.name}</span>
                    </button>
                    <FileTreeContextMenu node={node} />
                </div>
            </FileTreeRowContextMenu>
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
