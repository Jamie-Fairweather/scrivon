'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DiagramZoom } from '@/components/studio/canvas/use-pan-zoom'

type CanvasControlsContextValue = {
    canFitToView: boolean
    setCanFitToView: (canFit: boolean) => void
    fitToView: () => void
    registerFitToView: (fn: () => void) => () => void
    /** Zooms the diagram on screen in, out or back to 100%. Does nothing when none is shown. */
    zoomDiagram: (how: DiagramZoom) => void
    registerZoomDiagram: (fn: (how: DiagramZoom) => void) => () => void
}

const CanvasControlsContext = createContext<CanvasControlsContextValue | null>(null)

export function useCanvasControls(): CanvasControlsContextValue {
    const ctx = useContext(CanvasControlsContext)
    if (!ctx) throw new Error('useCanvasControls must be used within CanvasControlsProvider')
    return ctx
}

/** The canvas on screen hands in its function; the caller runs whichever canvas registered last, if it is still there. */
function useCanvasFunction<A extends unknown[]>() {
    const fnRef = useRef<((...args: A) => void) | null>(null)
    const register = useCallback((fn: (...args: A) => void) => {
        fnRef.current = fn
        return () => {
            if (fnRef.current === fn) fnRef.current = null
        }
    }, [])
    const call = useCallback((...args: A) => fnRef.current?.(...args), [])
    return [call, register] as const
}

function useCanvasControlsValue(): CanvasControlsContextValue {
    const [canFitToView, setCanFitToView] = useState(false)
    const [fitToView, registerFitToView] = useCanvasFunction<[]>()
    const [zoomDiagram, registerZoomDiagram] = useCanvasFunction<[DiagramZoom]>()

    // Kept the same between renders: this sits inside WorkspaceProvider, which draws again on every keystroke,
    // and a new object would draw every consumer (the menu bar, the palette search) again with it.
    return useMemo(
        () => ({ canFitToView, setCanFitToView, fitToView, registerFitToView, zoomDiagram, registerZoomDiagram }),
        [canFitToView, fitToView, registerFitToView, zoomDiagram, registerZoomDiagram]
    )
}

export function CanvasControlsProvider({ children }: { children: ReactNode }) {
    const value = useCanvasControlsValue()
    return <CanvasControlsContext.Provider value={value}>{children}</CanvasControlsContext.Provider>
}

/**
 * One editor group's diagram controls: its tab strip's Fit button acts on its own canvas. While the group has the
 * keyboard, it also stands in for the app's (the View menu, the palette, Ctrl+R and the zoom keys), so those act on
 * the focused group's diagram.
 */
export function GroupCanvasControlsProvider({ focused, children }: { focused: boolean; children: ReactNode }) {
    const app = useContext(CanvasControlsContext)
    const value = useCanvasControlsValue()
    const { canFitToView, fitToView, zoomDiagram } = value
    const setAppCanFit = app?.setCanFitToView
    const registerAppFit = app?.registerFitToView
    const registerAppZoom = app?.registerZoomDiagram

    useEffect(() => {
        if (!focused || !setAppCanFit) return
        setAppCanFit(canFitToView)
        return () => setAppCanFit(false)
    }, [focused, canFitToView, setAppCanFit])

    useEffect(() => {
        if (!focused || !registerAppFit || !registerAppZoom) return
        const stopFit = registerAppFit(fitToView)
        const stopZoom = registerAppZoom(zoomDiagram)
        return () => {
            stopFit()
            stopZoom()
        }
    }, [focused, fitToView, zoomDiagram, registerAppFit, registerAppZoom])

    return <CanvasControlsContext.Provider value={value}>{children}</CanvasControlsContext.Provider>
}
