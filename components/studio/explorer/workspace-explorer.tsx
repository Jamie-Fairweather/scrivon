'use client'

import { useSyncExternalStore } from 'react'
import { BookOpen, Files } from 'lucide-react'
import { ExamplesExplorer } from '@/components/studio/explorer/examples-explorer'
import { FileTreeNode } from '@/components/studio/explorer/file-tree-node'
import { FileTreeRootActions } from '@/components/studio/explorer/file-tree-root-actions'
import { CommandPaletteTriggerButton } from '@/components/studio/command-palette/command-palette-trigger-button'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const STORAGE_EXPLORER_PANEL = 'mermaid-studio-explorer-panel'

type ExplorerPanel = 'files' | 'examples'

const explorerPanelListeners = new Set<() => void>()

function getExplorerPanelSnapshot(): ExplorerPanel {
    const stored = sessionStorage.getItem(STORAGE_EXPLORER_PANEL)
    return stored === 'examples' ? 'examples' : 'files'
}

function getExplorerPanelServerSnapshot(): ExplorerPanel {
    return 'files'
}

function subscribeExplorerPanel(onStoreChange: () => void): () => void {
    explorerPanelListeners.add(onStoreChange)
    return () => explorerPanelListeners.delete(onStoreChange)
}

function setExplorerPanel(value: ExplorerPanel): void {
    sessionStorage.setItem(STORAGE_EXPLORER_PANEL, value)
    for (const listener of explorerPanelListeners) {
        listener()
    }
}

export function WorkspaceExplorer() {
    const { workspaceName, tree } = useWorkspaceSession()
    const panel = useSyncExternalStore(subscribeExplorerPanel, getExplorerPanelSnapshot, getExplorerPanelServerSnapshot)

    return (
        <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex shrink-0 flex-col gap-2 border-b border-sidebar-border px-2 py-2">
                <div className="flex items-center justify-center gap-0.5 px-0.5">
                    <Button
                        variant={panel === 'files' ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Files"
                        aria-pressed={panel === 'files'}
                        title="Files"
                        onClick={() => setExplorerPanel('files')}
                    >
                        <Files className="size-4" />
                    </Button>
                    <Button
                        variant={panel === 'examples' ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Examples"
                        aria-pressed={panel === 'examples'}
                        title="Examples"
                        onClick={() => setExplorerPanel('examples')}
                    >
                        <BookOpen className="size-4" />
                    </Button>
                    <CommandPaletteTriggerButton />
                </div>

                {panel === 'files' && (
                    <div className="flex flex-row items-center justify-between gap-2 px-1">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-muted-foreground uppercase">Workspace</p>
                            <p className="truncate text-sm font-medium" title={workspaceName ?? undefined}>
                                {workspaceName}
                            </p>
                        </div>
                        <FileTreeRootActions />
                    </div>
                )}

                {panel === 'examples' && <p className="px-1 text-center text-xs text-muted-foreground">View-only diagram and markdown samples</p>}
            </div>

            <div className={cn('flex min-h-0 flex-1 flex-col', panel === 'files' && 'px-1 py-2')}>
                {panel === 'files' ? (
                    <ScrollArea className="min-h-0 flex-1">
                        {tree.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No files in this folder.</p>
                        ) : (
                            tree.map((node) => <FileTreeNode key={node.path} node={node} />)
                        )}
                    </ScrollArea>
                ) : (
                    <ExamplesExplorer />
                )}
            </div>
        </aside>
    )
}
