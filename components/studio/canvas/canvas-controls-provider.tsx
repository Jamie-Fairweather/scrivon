'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type CanvasControlsContextValue = {
    canFitToView: boolean
    setCanFitToView: (canFit: boolean) => void
    fitToView: () => void
    registerFitToView: (fn: () => void) => () => void
}

const CanvasControlsContext = createContext<CanvasControlsContextValue | null>(null)

export function useCanvasControls(): CanvasControlsContextValue {
    const ctx = useContext(CanvasControlsContext)
    if (!ctx) throw new Error('useCanvasControls must be used within CanvasControlsProvider')
    return ctx
}

export function CanvasControlsProvider({ children }: { children: ReactNode }) {
    const fitFnRef = useRef<(() => void) | null>(null)
    const [canFitToView, setCanFitToView] = useState(false)

    const registerFitToView = useCallback((fn: () => void) => {
        fitFnRef.current = fn
        return () => {
            if (fitFnRef.current === fn) fitFnRef.current = null
        }
    }, [])

    const fitToView = useCallback(() => {
        fitFnRef.current?.()
    }, [])

    // Kept the same between renders: this sits inside WorkspaceProvider, which draws again on every keystroke,
    // and a new object would draw every consumer (the menu bar, the palette search) again with it.
    const value = useMemo(() => ({ canFitToView, setCanFitToView, fitToView, registerFitToView }), [canFitToView, fitToView, registerFitToView])

    return <CanvasControlsContext.Provider value={value}>{children}</CanvasControlsContext.Provider>
}
