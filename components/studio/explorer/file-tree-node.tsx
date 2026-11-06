'use client'

import { ChevronRight, FileCode2, FileText, Folder } from 'lucide-react'
import { useRef } from 'react'
import { FileTreeContextMenu, FileTreeRowContextMenu } from '@/components/studio/explorer/file-tree-context-menu'
import { isMarkdownFile, isMermaidFile, isSupportedDocument } from '@/lib/tauri/fs'
import type { VisibleTreeRow } from '@/lib/workspace/flatten-file-tree'
import type { FileNode } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

const UNSUPPORTED_HINT = 'Scrivon supports .md, .mmd and .mermaid files only'

type FileTreeNodeProps = {
    row: VisibleTreeRow
    isActive: boolean
    /** The one row the Tab key lands on; the arrow keys move between rows. */
    isTabStop: boolean
    onActivate: (node: FileNode) => void
    onFocusRow: (path: string) => void
}

/** One row of the file tree. FileTree supplies the row and handles the keys. */
export function FileTreeNode({ row, isActive, isTabStop, onActivate, onFocusRow }: FileTreeNodeProps) {
    const { node, level, expanded } = row
    const rowRef = useRef<HTMLDivElement>(null)
    const isMermaid = node.kind === 'file' && isMermaidFile(node.name)
    const isMarkdown = node.kind === 'file' && isMarkdownFile(node.name)
    const isUnsupported = node.kind === 'file' && !isSupportedDocument(node.name)

    return (
        <FileTreeRowContextMenu node={node}>
            {/* The actions button sits beside the row, not inside it, so its menu clicks never reach the row. */}
            <div
                className={cn(
                    'group me-1 flex min-w-0 items-center rounded-md hover:bg-sidebar-accent',
                    isActive && 'bg-sidebar-accent',
                    isUnsupported && 'hover:bg-transparent'
                )}
                style={{ marginLeft: `${(level - 1) * 12 + 4}px` }}
            >
                <div
                    ref={rowRef}
                    role="treeitem"
                    data-path={node.path}
                    aria-level={level}
                    aria-posinset={row.position}
                    aria-setsize={row.siblingCount}
                    aria-expanded={expanded}
                    aria-selected={isActive || undefined}
                    // Not aria-disabled: an unsupported file can still be renamed, duplicated and deleted. It just won't open.
                    aria-description={isUnsupported ? UNSUPPORTED_HINT : undefined}
                    tabIndex={isTabStop ? 0 : -1}
                    // The full name for names cut off by the narrow sidebar, plus why an unsupported file won't open.
                    title={isUnsupported ? `${node.name}\n${UNSUPPORTED_HINT}` : node.name}
                    className={cn(
                        `flex min-w-0 flex-1 cursor-default items-center gap-1 rounded-md px-2 py-1 text-left text-sm outline-none select-none
                        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`,
                        isActive && 'font-medium',
                        isUnsupported && 'text-muted-foreground/60'
                    )}
                    onClick={() => onActivate(node)}
                    onFocus={() => onFocusRow(node.path)}
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
                </div>
                <FileTreeContextMenu node={node} rowRef={rowRef} />
            </div>
        </FileTreeRowContextMenu>
    )
}
