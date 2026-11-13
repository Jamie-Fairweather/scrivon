'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
    /** The one heading the Tab key lands on; the arrow keys move between headings. */
    tabStopIndex: number
    onPick: (heading: OutlineHeading) => void
}

function OutlineList({ nodes, depth, currentIndex, tabStopIndex, onPick }: OutlineListProps) {
    return (
        <ul>
            {nodes.map((node) => {
                const current = node.index === currentIndex
                return (
                    <li key={node.heading.id}>
                        <button
                            type="button"
                            data-index={node.index}
                            tabIndex={node.index === tabStopIndex ? 0 : -1}
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
                            <OutlineList
                                nodes={node.children}
                                depth={depth + 1}
                                currentIndex={currentIndex}
                                tabStopIndex={tabStopIndex}
                                onPick={onPick}
                            />
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

/** Where a key moves focus in a list of `count` headings, from `at`. Null for keys the list doesn't use. */
function outlineKeyTarget(key: string, at: number, count: number): number | null {
    if (key === 'ArrowDown') return Math.min(at + 1, count - 1)
    if (key === 'ArrowUp') return Math.max(at - 1, 0)
    if (key === 'Home') return 0
    if (key === 'End') return count - 1
    return null
}

type OutlineTreeProps = Omit<OutlineListProps, 'depth' | 'tabStopIndex'> & { count: number }

/**
 * The headings as one Tab stop: the arrow keys, Home and End move between them, and Enter or Space picks one.
 * Memoized: the panel draws again on every keystroke, and the headings change far less often.
 */
const OutlineTree = memo(function OutlineTree({ nodes, count, currentIndex, onPick }: OutlineTreeProps) {
    const rootRef = useRef<HTMLElement>(null)
    // The heading with focus, while focus is in the list. Once it leaves, Tab comes back to the heading you're in.
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
    const tabStopIndex = focusedIndex !== null && focusedIndex < count ? focusedIndex : Math.max(currentIndex, 0)

    // Keeps the heading you're in on screen when the list is longer than the panel.
    useEffect(() => {
        rootRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }, [currentIndex])

    const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        const at = Number((e.target as HTMLElement).dataset.index)
        if (Number.isNaN(at)) return
        const next = outlineKeyTarget(e.key, at, count)
        if (next === null) return
        e.preventDefault()
        rootRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
    }

    return (
        <nav
            ref={rootRef}
            aria-label="Outline"
            className="py-1"
            onKeyDown={onKeyDown}
            onFocus={(e) => {
                const index = Number((e.target as HTMLElement).dataset.index)
                if (!Number.isNaN(index)) setFocusedIndex(index)
            }}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setFocusedIndex(null)
            }}
        >
            <OutlineList nodes={nodes} depth={0} currentIndex={currentIndex} tabStopIndex={tabStopIndex} onPick={onPick} />
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
    const editorOpen = layout.editorOpen
    // A hidden editor's cursor isn't where the user is looking, so nothing is marked then.
    const currentIndex = headings && editorOpen ? headingAtLine(headings, cursorLine) : -1

    const path = activeTab?.path ?? null
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
    else body = <OutlineTree nodes={tree} count={headings.length} currentIndex={currentIndex} onPick={onPick} />

    return (
        // A pane for F6 (pane-focus.ts), which goes to the list before the button above it.
        <aside data-pane="outline" className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            {/* As tall as the tab bar beside it, so their bottom borders line up. */}
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border ps-3 pe-1.5">
                <p className="truncate text-xs font-medium text-muted-foreground uppercase">Outline</p>
                <IconTooltip label="Hide Outline">
                    <Button variant="ghost" size="icon-xs" aria-label="Hide Outline" onClick={() => setOutlineOpen(false)}>
                        <X className="size-3.5" />
                    </Button>
                </IconTooltip>
            </div>
            {/* The list is a Tab stop of its own, so the scroll box isn't one. */}
            <ScrollArea data-pane-focus className="min-h-0 flex-1" viewportProps={{ tabIndex: -1 }}>
                {body}
            </ScrollArea>
        </aside>
    )
}
