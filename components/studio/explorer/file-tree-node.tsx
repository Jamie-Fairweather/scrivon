'use client'

import { ChevronRight, Ellipsis, FileCode2, FileText, Folder, Link2Off, Lock } from 'lucide-react'
import { memo, useId, useRef } from 'react'
import { FileTreeContextMenu, FileTreeRowContextMenu } from '@/components/studio/explorer/file-tree-context-menu'
import { isMarkdownFile, isMermaidFile, isSupportedDocument } from '@/lib/tauri/fs'
import { supportedExtensionsLabel } from '@/lib/workspace/file-types'
import type { VisibleTreeRow } from '@/lib/workspace/flatten-file-tree'
import { GIT_MARK_LABELS, type GitRowMark } from '@/lib/workspace/git-status'
import type { FileNode } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

const UNSUPPORTED_HINT = `Scrivon supports ${supportedExtensionsLabel('and')} files only`
const UNREADABLE_HINT = "Can't be read. Scrivon may not have permission to open it."
const LINKS_OUTSIDE_HINT = "Links to a folder outside the open one, which Scrivon can't open yet."
const TRUNCATED_HINT = 'Not read: the open folder has too many files and folders to list them all.'

/**
 * Each git mark's colour: the status text colours, which every theme keeps at 4.5:1 on the sidebar and on a
 * hovered or open row. Contrast themes draw them in the system's text colour, and the letter or dot still shows.
 */
const GIT_MARK_COLORS: Record<Exclude<GitRowMark, ''>, string> = {
    M: 'text-warning-foreground',
    A: 'text-success-foreground',
    U: 'text-success-foreground',
    R: 'text-info-foreground',
    C: 'text-destructive-foreground',
    changes: 'text-warning-foreground',
}

// The row's fields one by one, not the row object, so a row that didn't change isn't drawn again.
type FileTreeNodeProps = Omit<VisibleTreeRow, 'parentPath'> & {
    /**
     * The folder something dropped on this row goes into: the folder itself, or the folder a file is in. Empty
     * for a folder that can't be read, which takes nothing.
     */
    dropFolder: string
    /** Something being dragged would go into this folder. */
    isDropTarget: boolean
    /** This row is being dragged. */
    isDragged: boolean
    isActive: boolean
    /** The one row the Tab key lands on; the arrow keys move between rows. */
    isTabStop: boolean
    /** What git sees changed: a file's letter, `changes` for a folder holding changes, or ''. A string, so only rows whose mark changed draw again. */
    gitMark: GitRowMark
    onActivate: (node: FileNode, expanded: boolean | undefined) => void
    onFocusRow: (path: string) => void
}

/**
 * One row of the file tree. FileTree supplies the row and handles the keys. Memoized: every row has two menus, and
 * moving focus or typing in the editor would otherwise draw every visible row again.
 */
export const FileTreeNode = memo(function FileTreeNode({
    node,
    level,
    expanded,
    position,
    siblingCount,
    dropFolder,
    isDropTarget,
    isDragged,
    isActive,
    isTabStop,
    gitMark,
    onActivate,
    onFocusRow,
}: FileTreeNodeProps) {
    const rowRef = useRef<HTMLDivElement>(null)
    const hintId = useId()
    const gitId = useId()
    const isMermaid = node.kind === 'file' && isMermaidFile(node.name)
    const isMarkdown = node.kind === 'file' && isMarkdownFile(node.name)
    const isUnsupported = node.kind === 'file' && !isSupportedDocument(node.name)
    // A folder that couldn't be listed, or wasn't because the open folder is too big, opens onto nothing, so its row says why.
    const isUnreadable = node.kind === 'directory' && node.unreadable === true
    const linksOutside = node.kind === 'directory' && node.linksOutside === true
    const isTruncated = node.kind === 'directory' && node.truncated === true
    const folderHint = isUnreadable ? (linksOutside ? LINKS_OUTSIDE_HINT : UNREADABLE_HINT) : isTruncated ? TRUNCATED_HINT : null
    const hint = isUnsupported ? UNSUPPORTED_HINT : folderHint
    const gitLabel = gitMark ? GIT_MARK_LABELS[gitMark] : null
    const describedBy = [hint && hintId, gitLabel && gitId].filter(Boolean).join(' ')

    return (
        <FileTreeRowContextMenu node={node}>
            {/* The actions button sits beside the row, not inside it, so its menu clicks never reach the row. */}
            <div
                data-drop-folder={dropFolder}
                data-drop-target={isDropTarget ? '' : undefined}
                className={cn(
                    'group me-1 flex min-w-0 items-center rounded-md hover:bg-sidebar-accent/60',
                    // The open file: full fill (also under the pointer, so it doesn't look hovered) and an accent bar.
                    isActive && 'bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--ring)] hover:bg-sidebar-accent',
                    isUnsupported && 'hover:bg-transparent',
                    // The folder something being dragged would go into.
                    isDropTarget && 'bg-ring/15 ring-1 ring-ring ring-inset hover:bg-ring/15',
                    isDragged && 'opacity-50'
                )}
                style={{ marginLeft: `${(level - 1) * 12 + 4}px` }}
            >
                <div
                    ref={rowRef}
                    role="treeitem"
                    data-path={node.path}
                    aria-level={level}
                    aria-posinset={position}
                    aria-setsize={siblingCount}
                    aria-expanded={expanded}
                    aria-selected={isActive || undefined}
                    // Not aria-disabled: an unsupported file can still be renamed, duplicated and deleted. It just won't open.
                    aria-describedby={describedBy || undefined}
                    tabIndex={isTabStop ? 0 : -1}
                    // The full name for names cut off by the narrow sidebar, plus why an unsupported file or an unread folder won't
                    // open, and its git mark in words.
                    title={[node.name, hint, gitLabel].filter(Boolean).join('\n')}
                    className={cn(
                        `flex min-w-0 flex-1 cursor-default items-center gap-1 rounded-md px-2 py-1 text-left text-sm outline-none select-none
                        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`,
                        // Contrast themes drop the fill and the bar, so the open file is marked in the system highlight.
                        isActive && 'font-medium forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]',
                        (isUnsupported || isUnreadable || isTruncated) && 'text-muted-foreground'
                    )}
                    onClick={() => onActivate(node, expanded)}
                    onFocus={() => onFocusRow(node.path)}
                >
                    {node.kind === 'directory' ? (
                        <>
                            <ChevronRight
                                className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')}
                            />
                            <Folder className="size-4 shrink-0 text-muted-foreground" />
                        </>
                    ) : isMermaid ? (
                        <FileCode2 className="size-4 shrink-0 text-primary" />
                    ) : isMarkdown ? (
                        <FileText className="size-4 shrink-0 text-primary" />
                    ) : (
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span dir="auto" className={cn('truncate', node.kind === 'file' && gitMark && GIT_MARK_COLORS[gitMark])}>
                        {node.name}
                    </span>
                    {isUnreadable &&
                        (linksOutside ? (
                            <Link2Off data-mark="links-outside" className="size-3.5 shrink-0" />
                        ) : (
                            <Lock data-mark="unreadable" className="size-3.5 shrink-0" />
                        ))}
                    {isTruncated && !isUnreadable && <Ellipsis data-mark="truncated" className="size-3.5 shrink-0" />}
                    {hint && (
                        <span id={hintId} hidden>
                            {hint}
                        </span>
                    )}
                    {gitMark && (
                        <>
                            {/* Said in words by the description below: a letter alone means little to a screen reader. */}
                            <span
                                aria-hidden
                                data-git-mark={gitMark}
                                className={cn(
                                    'ms-auto shrink-0 ps-1 text-center font-medium',
                                    gitMark === 'changes' ? 'text-[0.5rem] leading-none' : 'w-4 text-xs',
                                    GIT_MARK_COLORS[gitMark]
                                )}
                            >
                                {gitMark === 'changes' ? '●' : gitMark}
                            </span>
                            <span id={gitId} hidden>
                                {gitLabel}
                            </span>
                        </>
                    )}
                </div>
                <FileTreeContextMenu node={node} rowRef={rowRef} />
            </div>
        </FileTreeRowContextMenu>
    )
})
