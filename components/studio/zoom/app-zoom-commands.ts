'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppZoom } from '@/components/studio/zoom/use-app-zoom'
import { DEFAULT_APP_ZOOM, formatZoomPercent, MAX_APP_ZOOM, MIN_APP_ZOOM, zoomInStep, zoomOutStep } from '@/lib/zoom/app-zoom'

export type AppZoomCommandsContext = {
    /** The app zoom now: 1 is 100%. */
    zoom: number
    setZoom: (zoom: number) => void
}

/** Zoom the whole app in, out, or back to 100%. */
export function buildAppZoomCommands({ zoom, setZoom }: AppZoomCommandsContext): AppCommand[] {
    const detail = `Now ${formatZoomPercent(zoom)}`
    return [
        {
            id: 'app-zoom-in',
            label: 'Zoom In',
            keywords: 'zoom bigger larger magnify text size scale',
            detail,
            keybind: 'view.appZoomIn',
            disabled: zoom >= MAX_APP_ZOOM,
            disabledReason: `Already at ${formatZoomPercent(MAX_APP_ZOOM)}`,
            run: () => setZoom(zoomInStep(zoom)),
        },
        {
            id: 'app-zoom-out',
            label: 'Zoom Out',
            keywords: 'zoom smaller shrink text size scale',
            detail,
            keybind: 'view.appZoomOut',
            disabled: zoom <= MIN_APP_ZOOM,
            disabledReason: `Already at ${formatZoomPercent(MIN_APP_ZOOM)}`,
            run: () => setZoom(zoomOutStep(zoom)),
        },
        {
            id: 'app-zoom-reset',
            label: 'Reset Zoom',
            keywords: 'zoom actual normal size 100% text scale',
            detail,
            keybind: 'view.appZoomReset',
            disabled: zoom === DEFAULT_APP_ZOOM,
            disabledReason: `Already at ${formatZoomPercent(DEFAULT_APP_ZOOM)}`,
            run: () => setZoom(DEFAULT_APP_ZOOM),
        },
    ]
}

export function useAppZoomCommands(): void {
    const { zoom, setZoom } = useAppZoom()
    const commands = useMemo(() => buildAppZoomCommands({ zoom, setZoom }), [zoom, setZoom])
    useRegisterCommands(commands)
}
