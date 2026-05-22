'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

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

    return (
        <CanvasControlsContext.Provider value={{ canFitToView, setCanFitToView, fitToView, registerFitToView }}>
            {children}
        </CanvasControlsContext.Provider>
    )
}
