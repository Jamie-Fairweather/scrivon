'use client'

import type { CSSProperties } from 'react'
import { Focus, Loader2, Lock, X } from 'lucide-react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { DiagramExportMenu } from '@/components/studio/editor/diagram-export-menu'
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

function TabCloseButton({
    tab,
    isActive,
    onClose,
}: {
    tab: { name: string; isDirty: boolean; isSaving: boolean; readOnly?: boolean }
    isActive: boolean
    onClose: () => void
}) {
    const showCloseSlot = isActive || (!tab.readOnly && tab.isDirty) || tab.isSaving

    return (
        <button
            type="button"
            className={cn(
                'mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                showCloseSlot ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
            )}
            aria-label={`Close ${tab.name}`}
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

    return (
        <div className={cn('flex h-9 shrink-0 items-stretch border-b border-border bg-background/95 backdrop-blur-sm', className)} style={style}>
            <LayoutToggleButtons />
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId
                    return (
                        <EditorTabRowContextMenu key={tab.id} tabId={tab.id}>
                            <div
                                className={cn(
                                    'group/tab flex max-w-[200px] min-w-0 items-center border-r border-border',
                                    isActive ? 'bg-muted/50' : 'hover:bg-muted/30'
                                )}
                            >
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-1 truncate py-2 pr-1 pl-3 text-left text-xs"
                                    onClick={() => void setActiveTab(tab.id)}
                                    title={tab.saveError ?? tab.path}
                                >
                                    {tab.readOnly && <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                                    <span className="truncate">{tab.name}</span>
                                </button>
                                <TabCloseButton tab={tab} isActive={isActive} onClose={() => void closeTab(tab.id)} />
                            </div>
                        </EditorTabRowContextMenu>
                    )
                })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 border-l border-border px-1">
                <DiagramExportMenu disabled={fitDisabled} />
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
