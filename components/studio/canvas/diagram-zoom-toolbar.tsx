'use client'

import { Focus, Minus, Plus } from 'lucide-react'
import { useSyncExternalStore, type ReactElement } from 'react'
import { stopCanvasGesture, type DiagramZoom, type ZoomLevel } from '@/components/studio/canvas/use-pan-zoom'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import type { KeybindActionId } from '@/lib/settings/types'

type DiagramZoomToolbarProps = {
    zoomLevel: ZoomLevel
    onZoom: (how: DiagramZoom) => void
    onFit: () => void
}

type ToolbarButtonProps = { label: string; tooltip: string; onClick: () => void; children: ReactElement }

function ToolbarButton({ label, tooltip, onClick, children }: ToolbarButtonProps) {
    return (
        <IconTooltip label={tooltip}>
            <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
                {children}
            </Button>
        </IconTooltip>
    )
}

/** Floats in the canvas's bottom-right corner: zoom out, the zoom level, zoom in, fit, and 100%. */
export function DiagramZoomToolbar({ zoomLevel, onZoom, onFit }: DiagramZoomToolbarProps) {
    const scale = useSyncExternalStore(zoomLevel.subscribe, zoomLevel.getScale, zoomLevel.getScale)
    const { settings } = useAppSettings()

    /** The tooltip text, with the user's shortcut when one is set, e.g. 'Zoom in (Alt+=)'. */
    const tooltip = (text: string, action: KeybindActionId) => {
        const keys = formatKeybindForAction(action, settings.keybinds)
        return keys ? `${text} (${keys})` : text
    }

    return (
        <div
            role="group"
            aria-label="Zoom"
            className="absolute right-3 bottom-3 z-20 flex cursor-auto items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5
                shadow-sm backdrop-blur-sm"
            onPointerDown={stopCanvasGesture}
            onDoubleClick={stopCanvasGesture}
        >
            <ToolbarButton label="Zoom out" tooltip={tooltip('Zoom out', 'view.zoomDiagramOut')} onClick={() => onZoom('out')}>
                <Minus />
            </ToolbarButton>
            <span className="min-w-10 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
            <ToolbarButton label="Zoom in" tooltip={tooltip('Zoom in', 'view.zoomDiagramIn')} onClick={() => onZoom('in')}>
                <Plus />
            </ToolbarButton>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <ToolbarButton label="Fit to screen" tooltip={tooltip('Fit to screen', 'view.fitDiagram')} onClick={onFit}>
                <Focus />
            </ToolbarButton>
            <ToolbarButton label="Reset to 100%" tooltip={tooltip('Reset to 100%', 'view.resetDiagramZoom')} onClick={() => onZoom('reset')}>
                <span className="text-[11px] font-medium">1:1</span>
            </ToolbarButton>
        </div>
    )
}
