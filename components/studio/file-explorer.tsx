'use client'

import { useWorkspaceSession } from '@/components/studio/workspace-provider'
import { FileTreeNode } from '@/components/studio/file-tree-node'
import { FileTreeRootActions } from '@/components/studio/file-tree-root-actions'
import { ScrollArea } from '@/components/ui/scroll-area'

export function FileExplorer() {
    const { workspaceName, tree } = useWorkspaceSession()

    return (
        <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex shrink-0 flex-row items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-muted-foreground uppercase">Explorer</p>
                    <p className="truncate text-sm font-medium" title={workspaceName ?? undefined}>
                        {workspaceName}
                    </p>
                </div>
                <FileTreeRootActions />
            </div>
            <ScrollArea className="min-h-0 flex-1 px-1 py-2">
                {tree.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No files in this folder.</p>
                ) : (
                    tree.map((node) => <FileTreeNode key={node.path} node={node} />)
                )}
            </ScrollArea>
        </aside>
    )
}
