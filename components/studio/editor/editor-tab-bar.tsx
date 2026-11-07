'use client'

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { CircleAlert, Focus, Loader2, Lock, X } from 'lucide-react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { DocumentExportMenu } from '@/components/studio/editor/document-export-menu'
import { LayoutToggleButtons } from '@/components/studio/editor/layout-toggle-buttons'
import { EditorTabRowContextMenu } from '@/components/studio/editor/editor-tab-context-menu'
import { getTabFolderHints } from '@/components/studio/editor/tab-labels'
import { useMarkdownExpand } from '@/components/studio/markdown/markdown-expand-context'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { displayPath } from '@/lib/workspace/display-path'
import { documentKind } from '@/lib/workspace/file-types'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type EditorTabBarProps = {
    className?: string
    style?: CSSProperties
}

type TabState = { id: string; name: string; isDirty: boolean; isSaving: boolean; saveError?: string; readOnly?: boolean }

/** What a screen reader should hear after the tab's name. */
function tabStatusText(tab: TabState): string {
    const parts: string[] = []
    // Examples are read-only, and so are files on disk that can't be edited safely.
    if (tab.readOnly) parts.push(isExampleTabId(tab.id) ? 'read-only example' : 'read-only')
    else if (tab.isDirty) parts.push('unsaved changes')
    if (tab.isSaving) parts.push('saving')
    if (tab.saveError) parts.push(`save failed: ${tab.saveError}`)
    return parts.join(', ')
}

function TabCloseButton({ tab, label, isActive, onClose }: { tab: TabState; label: string; isActive: boolean; onClose: () => void }) {
    const showCloseSlot = isActive || (!tab.readOnly && tab.isDirty) || tab.isSaving
    const unsaved = !tab.readOnly && tab.isDirty

    return (
        <button
            type="button"
            // One tab stop for the whole strip (arrow keys move between tabs). Hidden from screen
            // readers too, since a tab list may only hold tabs: Delete or Ctrl+W on the tab, or
            // its context menu, close it from the keyboard.
            tabIndex={-1}
            aria-hidden="true"
            className={cn(
                'mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                showCloseSlot ? 'opacity-100' : 'opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100'
            )}
            aria-label={`Close ${label}${unsaved ? ', unsaved changes' : ''}`}
            onClick={(e) => {
                e.stopPropagation()
                onClose()
            }}
        >
            {tab.isSaving ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : (
                <>
                    {!tab.readOnly && tab.isDirty && <span className="size-2 rounded-full bg-foreground group-hover/tab:hidden" aria-hidden />}
                    <X className={cn('size-3.5', !tab.readOnly && tab.isDirty && 'hidden group-hover/tab:block')} aria-hidden />
                </>
            )}
        </button>
    )
}

export function EditorTabBar({ className, style }: EditorTabBarProps) {
    const { tabs, activeTabId, setActiveTab, closeTab, activeTab } = useDocumentTabs()
    const { canFitToView, fitToView } = useCanvasControls()
    const { expanded } = useMarkdownExpand()

    const tabKind = activeTab ? documentKind(activeTab.name) : null
    const markdownNeedsExpand = tabKind === 'markdown' && !expanded
    const fitDisabled = !canFitToView || markdownNeedsExpand
    // Says why when Fit can't be used: a diagram that failed to draw, an empty file, no tab.
    const fitLabel = markdownNeedsExpand ? 'Expand a Mermaid block to fit' : fitDisabled ? 'No diagram to fit' : 'Fit diagram to screen'

    const stripRef = useRef<HTMLDivElement>(null)
    const tabRefs = useRef(new Map<string, HTMLButtonElement>())
    // The tab reachable with Tab: the active one, or the first if none is active.
    const focusableTabId = tabs.some((t) => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null)
    // Same-named files (README.md in two folders) also show the folder that tells them apart.
    const folderHints = useMemo(() => getTabFolderHints(tabs), [tabs])

    useEffect(() => {
        if (!activeTabId) return
        tabRefs.current.get(activeTabId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }, [activeTabId])

    // The strip has no visible scrollbar (it would squash the tabs), so the mouse wheel scrolls it sideways.
    useEffect(() => {
        const strip = stripRef.current
        if (!strip) return
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || strip.scrollWidth <= strip.clientWidth) return
            e.preventDefault()
            strip.scrollLeft += e.deltaY
        }
        strip.addEventListener('wheel', onWheel, { passive: false })
        return () => strip.removeEventListener('wheel', onWheel)
    }, [])

    const onTabListKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            const index = tabs.findIndex((t) => tabRefs.current.get(t.id) === e.target)
            if (index === -1) return
            let next: number
            if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
            else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
            else if (e.key === 'Home') next = 0
            else if (e.key === 'End') next = tabs.length - 1
            else if (e.key === 'Delete') {
                e.preventDefault()
                void closeTab(tabs[index]!.id)
                return
            } else return
            e.preventDefault()
            const nextTab = tabs[next]!
            tabRefs.current.get(nextTab.id)?.focus()
            void setActiveTab(nextTab.id)
        },
        [tabs, setActiveTab, closeTab]
    )

    return (
        // Once one toolbar tooltip has shown, moving to the next button shows its tooltip straight away.
        <TooltipProvider delay={400}>
            <div
                data-slot="editor-tab-bar"
                className={cn('flex h-9 shrink-0 items-stretch border-b border-border bg-background/95 backdrop-blur-sm', className)}
                style={style}
            >
                <LayoutToggleButtons />
                <div
                    ref={stripRef}
                    role="tablist"
                    aria-label="Open documents"
                    className="flex min-w-0 flex-1 [scrollbar-width:none] items-stretch overflow-x-auto"
                    onKeyDown={onTabListKeyDown}
                >
                    {tabs.map((tab) => {
                        const isActive = tab.id === activeTabId
                        const status = tabStatusText(tab)
                        const folderHint = folderHints.get(tab.id)
                        return (
                            <EditorTabRowContextMenu key={tab.id} tabId={tab.id}>
                                <div
                                    role="presentation"
                                    className={cn(
                                        // Tabs keep a readable width; when they don't all fit, the strip scrolls.
                                        'group/tab flex max-w-[200px] min-w-[100px] shrink-0 items-center border-r border-border',
                                        // Outlined while its right-click menu is open, since that doesn't switch to it.
                                        'in-data-[menu-open]:ring-1 in-data-[menu-open]:ring-ring/60 in-data-[menu-open]:ring-inset',
                                        // The open tab: full-strength text and an accent line along its bottom edge
                                        // (the ring colour, at least 3:1 on the background). The others are muted.
                                        isActive
                                            ? 'bg-background text-foreground shadow-[inset_0_-2px_0_var(--ring)]'
                                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                                    )}
                                >
                                    <button
                                        ref={(el) => {
                                            if (el) tabRefs.current.set(tab.id, el)
                                            else tabRefs.current.delete(tab.id)
                                        }}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        tabIndex={tab.id === focusableTabId ? 0 : -1}
                                        className="flex min-w-0 flex-1 items-center gap-1 truncate py-2 pr-1 pl-3 text-left text-xs"
                                        onClick={() => void setActiveTab(tab.id)}
                                        title={tab.saveError ? `${displayPath(tab.path)}\nSave failed: ${tab.saveError}` : displayPath(tab.path)}
                                    >
                                        {tab.readOnly && <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                                        {tab.saveError && <CircleAlert className="size-3 shrink-0 text-destructive" aria-hidden />}
                                        <span dir="auto" className="truncate">
                                            {tab.name}
                                        </span>
                                        {folderHint && (
                                            // Shrinks much faster than the name, so it is cut off first.
                                            <span className="shrink-[100] truncate text-[10px] text-muted-foreground">
                                                <span className="sr-only">in </span>
                                                {displayPath(folderHint)}
                                            </span>
                                        )}
                                        {status && <span className="sr-only">, {status}</span>}
                                    </button>
                                    <TabCloseButton
                                        tab={tab}
                                        label={folderHint ? `${tab.name} in ${folderHint}` : tab.name}
                                        isActive={isActive}
                                        onClose={() => void closeTab(tab.id)}
                                    />
                                </div>
                            </EditorTabRowContextMenu>
                        )
                    })}
                </div>
                <div className="flex shrink-0 items-center gap-0.5 border-l border-border px-1">
                    <DocumentExportMenu />
                    {/* aria-disabled rather than disabled, so it can still be focused or hovered to say why. */}
                    <IconTooltip label={fitLabel}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Fit diagram to screen"
                            aria-disabled={fitDisabled || undefined}
                            className="aria-disabled:cursor-default aria-disabled:opacity-64 aria-disabled:hover:bg-transparent"
                            onClick={fitDisabled ? undefined : fitToView}
                        >
                            <Focus className="size-4" />
                        </Button>
                    </IconTooltip>
                </div>
            </div>
        </TooltipProvider>
    )
}
