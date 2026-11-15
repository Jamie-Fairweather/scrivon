'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
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

export function CanvasControlsProvider({ children }: { children: ReactNode }) {
    const [canFitToView, setCanFitToView] = useState(false)
    const [fitToView, registerFitToView] = useCanvasFunction<[]>()
    const [zoomDiagram, registerZoomDiagram] = useCanvasFunction<[DiagramZoom]>()

    // Kept the same between renders: this sits inside WorkspaceProvider, which draws again on every keystroke,
    // and a new object would draw every consumer (the menu bar, the palette search) again with it.
    const value = useMemo(
        () => ({ canFitToView, setCanFitToView, fitToView, registerFitToView, zoomDiagram, registerZoomDiagram }),
        [canFitToView, fitToView, registerFitToView, zoomDiagram, registerZoomDiagram]
    )

    return <CanvasControlsContext.Provider value={value}>{children}</CanvasControlsContext.Provider>
}
