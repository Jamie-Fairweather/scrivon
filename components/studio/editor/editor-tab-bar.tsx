'use client'

import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { CircleAlert, Focus, Loader2, Lock, X } from 'lucide-react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { DocumentExportMenu } from '@/components/studio/editor/document-export-menu'
import { LayoutToggleButtons } from '@/components/studio/editor/layout-toggle-buttons'
import { EditorTabRowContextMenu } from '@/components/studio/editor/editor-tab-context-menu'
import { useMarkdownExpand } from '@/components/studio/markdown/markdown-expand-context'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { documentKind } from '@/lib/workspace/file-types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type EditorTabBarProps = {
    className?: string
    style?: CSSProperties
}

type TabState = { name: string; isDirty: boolean; isSaving: boolean; saveError?: string; readOnly?: boolean }

/** What a screen reader should hear after the tab's name. */
function tabStatusText(tab: TabState): string {
    const parts: string[] = []
    if (tab.readOnly) parts.push('read-only example')
    else if (tab.isDirty) parts.push('unsaved changes')
    if (tab.isSaving) parts.push('saving')
    if (tab.saveError) parts.push(`save failed: ${tab.saveError}`)
    return parts.join(', ')
}

function TabCloseButton({ tab, isActive, onClose }: { tab: TabState; isActive: boolean; onClose: () => void }) {
    const showCloseSlot = isActive || (!tab.readOnly && tab.isDirty) || tab.isSaving
    const unsaved = !tab.readOnly && tab.isDirty

    return (
        <button
            type="button"
            // One tab stop for the whole strip (arrow keys move between tabs); Ctrl+W and the
            // tab's context menu close it from the keyboard.
            tabIndex={-1}
            className={cn(
                'mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                showCloseSlot ? 'opacity-100' : 'opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100'
            )}
            aria-label={`Close ${tab.name}${unsaved ? ', unsaved changes' : ''}`}
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

    const stripRef = useRef<HTMLDivElement>(null)
    const tabRefs = useRef(new Map<string, HTMLButtonElement>())
    // The tab reachable with Tab: the active one, or the first if none is active.
    const focusableTabId = tabs.some((t) => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null)

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
            else return
            e.preventDefault()
            const nextTab = tabs[next]!
            tabRefs.current.get(nextTab.id)?.focus()
            void setActiveTab(nextTab.id)
        },
        [tabs, setActiveTab]
    )

    return (
        <div className={cn('flex h-9 shrink-0 items-stretch border-b border-border bg-background/95 backdrop-blur-sm', className)} style={style}>
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
                    return (
                        <EditorTabRowContextMenu key={tab.id} tabId={tab.id}>
                            <div
                                role="presentation"
                                className={cn(
                                    // Tabs keep a readable width; when they don't all fit, the strip scrolls.
                                    'group/tab flex max-w-[200px] min-w-[100px] shrink-0 items-center border-r border-border',
                                    isActive ? 'bg-muted/50' : 'hover:bg-muted/30'
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
                                    title={tab.saveError ? `Save failed: ${tab.saveError}` : tab.path}
                                >
                                    {tab.readOnly && <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                                    {tab.saveError && <CircleAlert className="size-3 shrink-0 text-destructive" aria-hidden />}
                                    <span className="truncate">{tab.name}</span>
                                    {status && <span className="sr-only">, {status}</span>}
                                </button>
                                <TabCloseButton tab={tab} isActive={isActive} onClose={() => void closeTab(tab.id)} />
                            </div>
                        </EditorTabRowContextMenu>
                    )
                })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 border-l border-border px-1">
                <DocumentExportMenu />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Fit diagram to screen"
                    title={markdownNeedsExpand ? 'Expand a Mermaid block to fit' : 'Fit diagram to screen'}
                    disabled={fitDisabled}
                    onClick={fitToView}
                >
                    <Focus className="size-4" />
                </Button>
            </div>
        </div>
    )
}
