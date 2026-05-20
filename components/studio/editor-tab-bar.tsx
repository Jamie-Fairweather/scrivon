'use client'

import type { CSSProperties } from 'react'
import { Focus, Loader2, X } from 'lucide-react'
import { useCanvasControls } from '@/components/studio/canvas-controls-provider'
import { LayoutToggleButtons } from '@/components/studio/layout-toggle-buttons'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { cn } from '@/lib/utils'

type EditorTabBarProps = {
    className?: string
    style?: CSSProperties
}

export function EditorTabBar({ className, style }: EditorTabBarProps) {
    const { tabs, activeTabId, setActiveTab, closeTab } = useWorkspace()
    const { canFitToView, fitToView } = useCanvasControls()

    return (
        <div
            className={cn('flex h-9 shrink-0 items-stretch border-b border-border bg-background/95 backdrop-blur-sm', className)}
            style={style}
        >
            <LayoutToggleButtons />
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                return (
                    <div
                        key={tab.id}
                        className={cn(
                            'group flex max-w-[200px] min-w-0 items-center border-r border-border',
                            isActive ? 'bg-muted/50' : 'hover:bg-muted/30'
                        )}
                    >
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-xs"
                            onClick={() => void setActiveTab(tab.id)}
                            title={tab.saveError ?? tab.path}
                        >
                            <span className="flex size-3 shrink-0 items-center justify-center" aria-hidden>
                                {tab.isSaving ? (
                                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                                ) : tab.isDirty ? (
                                    <span className="size-2 rounded-full bg-primary" />
                                ) : null}
                            </span>
                            <span className="truncate">{tab.name}</span>
                        </button>
                        <button
                            type="button"
                            className="mr-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
                            aria-label={`Close ${tab.name}`}
                            onClick={(e) => {
                                e.stopPropagation()
                                void closeTab(tab.id)
                            }}
                        >
                            <X className="size-3.5" />
                        </button>
                    </div>
                )
            })}
            </div>
            <div className="flex shrink-0 items-center border-l border-border px-1">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Fit diagram to screen"
                    title="Fit diagram to screen"
                    disabled={!canFitToView}
                    onClick={fitToView}
                >
                    <Focus className="size-4" />
                </Button>
            </div>
        </div>
    )
}
