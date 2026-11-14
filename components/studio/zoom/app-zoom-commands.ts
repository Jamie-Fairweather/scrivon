'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { useAppZoom } from '@/components/studio/zoom/use-app-zoom'
import { DEFAULT_APP_ZOOM, formatZoomPercent, MAX_APP_ZOOM, MIN_APP_ZOOM, zoomInStep, zoomOutStep } from '@/lib/zoom/app-zoom'

export type AppZoomCommandsContext = {
    /** The app zoom now: 1 is 100%. */
    zoom: number
    setZoom: (zoom: number) => void
    /** Only the desktop app zooms itself; a browser has its own zoom. */
    isDesktop: boolean
}

/** Zoom the whole app in, out, or back to 100%. */
export function buildAppZoomCommands({ zoom, setZoom, isDesktop }: AppZoomCommandsContext): AppCommand[] {
    const detail = `Now ${formatZoomPercent(zoom)}`
    const alreadyAt = (limit: number) => (isDesktop ? `Already at ${formatZoomPercent(limit)}` : 'Desktop only')
    return [
        {
            id: 'app-zoom-in',
            label: 'Zoom In',
            keywords: 'zoom bigger larger magnify text size scale',
            detail,
            keybind: 'view.appZoomIn',
            disabled: !isDesktop || zoom >= MAX_APP_ZOOM,
            disabledReason: alreadyAt(MAX_APP_ZOOM),
            run: () => setZoom(zoomInStep(zoom)),
        },
        {
            id: 'app-zoom-out',
            label: 'Zoom Out',
            keywords: 'zoom smaller shrink text size scale',
            detail,
            keybind: 'view.appZoomOut',
            disabled: !isDesktop || zoom <= MIN_APP_ZOOM,
            disabledReason: alreadyAt(MIN_APP_ZOOM),
            run: () => setZoom(zoomOutStep(zoom)),
        },
        {
            id: 'app-zoom-reset',
            label: 'Reset Zoom',
            keywords: 'zoom actual normal size 100% text scale',
            detail,
            keybind: 'view.appZoomReset',
            disabled: !isDesktop || zoom === DEFAULT_APP_ZOOM,
            disabledReason: alreadyAt(DEFAULT_APP_ZOOM),
            run: () => setZoom(DEFAULT_APP_ZOOM),
        },
    ]
}

export function useAppZoomCommands(): void {
    const { zoom, setZoom } = useAppZoom()
    const { isDesktop } = useWorkspaceSession()
    const commands = useMemo(() => buildAppZoomCommands({ zoom, setZoom, isDesktop }), [zoom, setZoom, isDesktop])
    useRegisterCommands(commands)
}
