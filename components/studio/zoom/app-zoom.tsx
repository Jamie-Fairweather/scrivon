'use client'

import { useEffect } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useAppZoom } from '@/components/studio/zoom/use-app-zoom'
import { isTauri } from '@/lib/tauri/platform'
import { createWheelZoom, OWN_ZOOM_SELECTOR, zoomInStep, zoomOutStep } from '@/lib/zoom/app-zoom'

/**
 * Zooms the whole window to the saved zoom, as a browser's Ctrl+= does, and lets Ctrl+wheel change it.
 * Ctrl+wheel over the diagram canvas is left to the canvas, which zooms the diagram. In a browser,
 * zoom is left to the browser.
 */
export function AppZoom() {
    const { zoom, setZoom } = useAppZoom()

    useEffect(() => {
        if (!isTauri()) return
        getCurrentWebview()
            .setZoom(zoom)
            .catch((err: unknown) => console.warn("Couldn't zoom the window", err))
    }, [zoom])

    useEffect(() => {
        if (!isTauri()) return
        const wheelZoom = createWheelZoom()
        const onWheel = (event: WheelEvent) => {
            // A touchpad pinch arrives as Ctrl+wheel too.
            if (!event.ctrlKey && !event.metaKey) return
            if (event.target instanceof Element && event.target.closest(OWN_ZOOM_SELECTOR)) return
            // Taken before the editor or a pane sees it, so they don't scroll as well.
            event.preventDefault()
            event.stopPropagation()
            const step = wheelZoom(event)
            if (step !== 0) setZoom(step > 0 ? zoomInStep : zoomOutStep)
        }
        window.addEventListener('wheel', onWheel, { capture: true, passive: false })
        return () => window.removeEventListener('wheel', onWheel, { capture: true })
    }, [setZoom])

    return null
}
