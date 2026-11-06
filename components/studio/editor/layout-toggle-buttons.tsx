'use client'

import { Code2, PanelLeft } from 'lucide-react'
import { useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'

export function LayoutToggleButtons() {
    const { layout, setExplorerOpen, setEditorOpen } = useStudioLayout()

    return (
        <div className="flex shrink-0 items-center gap-0.5 border-r border-border px-1">
            <IconTooltip label="Toggle explorer">
                <Button
                    variant={layout.explorerOpen ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label="Toggle explorer"
                    onClick={() => setExplorerOpen(!layout.explorerOpen)}
                >
                    <PanelLeft className="size-4" />
                </Button>
            </IconTooltip>
            <IconTooltip label="Toggle editor">
                <Button
                    variant={layout.editorOpen ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label="Toggle editor"
                    onClick={() => setEditorOpen(!layout.editorOpen)}
                >
                    <Code2 className="size-4" />
                </Button>
            </IconTooltip>
        </div>
    )
}
