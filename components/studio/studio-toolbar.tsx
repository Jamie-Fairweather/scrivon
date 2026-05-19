'use client'

import { Code2, Eye, FolderClosed, FolderOpen, PanelLeft } from 'lucide-react'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { Button } from '@/components/ui/button'
export function StudioToolbar() {
    const { workspaceName, layout, setExplorerOpen, setEditorOpen, setPreviewOnly, closeWorkspace, pickAndOpenWorkspace } = useWorkspace()

    return (
        <header className="pointer-events-auto flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 backdrop-blur-sm">
            <Button
                variant={layout.explorerOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Toggle explorer"
                title="Toggle explorer"
                onClick={() => setExplorerOpen(!layout.explorerOpen)}
            >
                <PanelLeft className="size-4" />
            </Button>
            <Button
                variant={layout.editorOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Toggle editor"
                title="Toggle editor"
                onClick={() => setEditorOpen(!layout.editorOpen)}
            >
                <Code2 className="size-4" />
            </Button>
            <Button
                variant={!layout.explorerOpen && !layout.editorOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Preview only"
                title="Preview only"
                onClick={setPreviewOnly}
            >
                <Eye className="size-4" />
            </Button>

            <div className="mx-2 h-5 w-px bg-border" />

            <span className="max-w-[240px] truncate text-sm text-muted-foreground" title={workspaceName ?? undefined}>
                {workspaceName}
            </span>

            <div className="flex-1" />

            <Button variant="ghost" size="sm" onClick={() => void pickAndOpenWorkspace()}>
                <FolderOpen className="size-4" />
                Open Folder
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void closeWorkspace()}>
                <FolderClosed className="size-4" />
                Close Folder
            </Button>
        </header>
    )
}
