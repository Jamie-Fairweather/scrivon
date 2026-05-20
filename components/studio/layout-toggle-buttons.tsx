'use client'

import { Code2, PanelLeft } from 'lucide-react'
import { useWorkspace } from '@/components/studio/workspace-provider'
import { Button } from '@/components/ui/button'

export function LayoutToggleButtons() {
    const { layout, setExplorerOpen, setEditorOpen } = useWorkspace()

    return (
        <div className="flex shrink-0 items-center gap-0.5 border-r border-border px-1">
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
        </div>
    )
}
