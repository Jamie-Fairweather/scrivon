'use client'

import { Focus, Minus, Plus } from 'lucide-react'
import { useSyncExternalStore, type ReactElement } from 'react'
import type { DiagramZoom, ZoomLevel } from '@/components/studio/canvas/use-pan-zoom'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'

type DiagramZoomToolbarProps = {
    zoomLevel: ZoomLevel
    onZoom: (how: DiagramZoom) => void
    onFit: () => void
}

/** Clicks here are the buttons', not the start of a drag or a double-click reset on the canvas. */
function stopCanvasGesture(event: React.SyntheticEvent) {
    event.stopPropagation()
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactElement }) {
    return (
        <IconTooltip label={label}>
            <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
                {children}
            </Button>
        </IconTooltip>
    )
}

/** Floats in the canvas's bottom-right corner: zoom out, the zoom level, zoom in, fit, and 100%. */
export function DiagramZoomToolbar({ zoomLevel, onZoom, onFit }: DiagramZoomToolbarProps) {
    const scale = useSyncExternalStore(zoomLevel.subscribe, zoomLevel.getScale, zoomLevel.getScale)

    return (
        <div
            role="group"
            aria-label="Zoom"
            className="absolute right-3 bottom-3 z-20 flex cursor-auto items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5
                shadow-sm backdrop-blur-sm"
            onPointerDown={stopCanvasGesture}
            onDoubleClick={stopCanvasGesture}
        >
            <ToolbarButton label="Zoom out" onClick={() => onZoom('out')}>
                <Minus />
            </ToolbarButton>
            <span className="min-w-10 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
            <ToolbarButton label="Zoom in" onClick={() => onZoom('in')}>
                <Plus />
            </ToolbarButton>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <ToolbarButton label="Fit to screen" onClick={onFit}>
                <Focus />
            </ToolbarButton>
            <ToolbarButton label="Reset to 100%" onClick={() => onZoom('reset')}>
                <span className="text-[11px] font-medium">1:1</span>
            </ToolbarButton>
        </div>
    )
}
