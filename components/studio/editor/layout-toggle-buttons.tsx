'use client'

import { Code2, PanelLeft } from 'lucide-react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import type { KeybindActionId } from '@/lib/settings/types'
import { toggleButtonClassName } from '@/lib/ui/button-classes'

export function LayoutToggleButtons() {
    const { layout, setExplorerOpen, setEditorOpen } = useStudioLayout()
    const { settings } = useAppSettings()

    /** The tooltip text, with the user's shortcut when one is set, e.g. 'Toggle explorer (Ctrl+B)'. */
    const label = (text: string, action: KeybindActionId) => {
        const keys = formatKeybindForAction(action, settings.keybinds)
        return keys ? `${text} (${keys})` : text
    }

    // aria-label stays fixed; aria-pressed tells screen readers whether the panel is shown.
    return (
        <div className="flex shrink-0 items-center gap-0.5 border-r border-border px-1">
            <IconTooltip label={label('Toggle explorer', 'view.toggleExplorer')}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className={toggleButtonClassName}
                    aria-label="Toggle explorer"
                    aria-pressed={layout.explorerOpen}
                    onClick={() => setExplorerOpen(!layout.explorerOpen)}
                >
                    <PanelLeft className="size-4" />
                </Button>
            </IconTooltip>
            <IconTooltip label={label('Toggle editor', 'view.toggleEditor')}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className={toggleButtonClassName}
                    aria-label="Toggle editor"
                    aria-pressed={layout.editorOpen}
                    onClick={() => setEditorOpen(!layout.editorOpen)}
                >
                    <Code2 className="size-4" />
                </Button>
            </IconTooltip>
        </div>
    )
}
