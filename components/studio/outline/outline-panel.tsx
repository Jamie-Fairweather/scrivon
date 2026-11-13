'use client'

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { useEditorCursorLine } from '@/components/studio/editor/editor-cursor'
import { revealHeadingInPreview } from '@/components/studio/markdown/preview-heading'
import { useMarkdownOutline } from '@/components/studio/outline/use-markdown-outline'
import { useDocumentTabs, useStudioLayout, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { headingAtLine, outlineTree, type OutlineHeading, type OutlineNode } from '@/lib/markdown/document-outline'
import { documentKind } from '@/lib/workspace/file-types'
import { cn } from '@/lib/utils'

type OutlineListProps = {
    nodes: OutlineNode[]
    depth: number
    currentIndex: number
    onPick: (heading: OutlineHeading) => void
}

function OutlineList({ nodes, depth, currentIndex, onPick }: OutlineListProps) {
    return (
        <ul>
            {nodes.map((node) => {
                const current = node.index === currentIndex
                return (
                    <li key={node.heading.id}>
                        <button
                            type="button"
                            className={cn(
                                'block w-full truncate py-1 pe-2 text-left text-xs transition-colors hover:bg-sidebar-accent/60',
                                depth === 0 && 'font-medium',
                                // Like the open file in the file tree.
                                current &&
                                    `bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--ring)]
                                    hover:bg-sidebar-accent`
                            )}
                            style={{ paddingInlineStart: 12 + depth * 12 }}
                            aria-current={current ? 'true' : undefined}
                            title={node.heading.text}
                            onClick={() => onPick(node.heading)}
                        >
                            <span dir="auto">{node.heading.text}</span>
                        </button>
                        {node.children.length > 0 && (
                            <OutlineList nodes={node.children} depth={depth + 1} currentIndex={currentIndex} onPick={onPick} />
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

/** Memoized: the panel draws again on every keystroke, and the headings change far less often. */
const OutlineTree = memo(function OutlineTree({ nodes, currentIndex, onPick }: Omit<OutlineListProps, 'depth'>) {
    const rootRef = useRef<HTMLElement>(null)

    // Keeps the heading you're in on screen when the list is longer than the panel.
    useEffect(() => {
        rootRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }, [currentIndex])

    return (
        <nav ref={rootRef} aria-label="Outline" className="py-1">
            <OutlineList nodes={nodes} depth={0} currentIndex={currentIndex} onPick={onPick} />
        </nav>
    )
})

function EmptyOutline({ children }: { children: string }) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}

/** Lists the headings of the Markdown file on screen. Clicking one moves the editor and the preview to it. */
export function OutlinePanel() {
    const { activeTab } = useDocumentTabs()
    const { layout, setOutlineOpen } = useStudioLayout()
    const coordinator = useWorkspaceCoordinator()
    const isMarkdown = activeTab !== null && documentKind(activeTab.name) === 'markdown'
    const headings = useMarkdownOutline(isMarkdown ? activeTab.id : null, isMarkdown ? activeTab.content : null)
    const tree = useMemo(() => (headings ? outlineTree(headings) : []), [headings])
    const cursorLine = useEditorCursorLine()
    const currentIndex = headings ? headingAtLine(headings, cursorLine) : -1

    const path = activeTab?.path ?? null
    const editorOpen = layout.editorOpen
    const onPick = useCallback(
        (heading: OutlineHeading) => {
            revealHeadingInPreview(heading.id)
            // A hidden editor would jump, and take the keyboard, whenever it is next shown.
            if (path !== null && editorOpen) coordinator.revealInEditor.current(path, heading.line, 1)
        },
        [path, editorOpen, coordinator]
    )

    let body
    if (!activeTab) body = <EmptyOutline>Open a Markdown file to see its headings.</EmptyOutline>
    else if (!isMarkdown) body = <EmptyOutline>Only Markdown files have an outline.</EmptyOutline>
    // Still reading this file for the first time: nothing yet, rather than "No headings" for a moment.
    else if (headings === null) body = null
    else if (headings.length === 0) body = <EmptyOutline>No headings yet. Start a line with # to add one.</EmptyOutline>
    else body = <OutlineTree nodes={tree} currentIndex={currentIndex} onPick={onPick} />

    return (
        <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            {/* As tall as the tab bar beside it, so their bottom borders line up. */}
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border ps-3 pe-1.5">
                <p className="truncate text-xs font-medium text-muted-foreground uppercase">Outline</p>
                <IconTooltip label="Hide Outline">
                    <Button variant="ghost" size="icon-xs" aria-label="Hide Outline" onClick={() => setOutlineOpen(false)}>
                        <X className="size-3.5" />
                    </Button>
                </IconTooltip>
            </div>
            {/* Every heading is a button of its own, so the scroll box isn't a Tab stop. */}
            <ScrollArea className="min-h-0 flex-1" viewportProps={{ tabIndex: -1 }}>
                {body}
            </ScrollArea>
        </aside>
    )
}
