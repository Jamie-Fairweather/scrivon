'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPresentFullscreen, type PresentFullscreen } from '@/components/studio/present/present-fullscreen'

export type PresentMode = {
    /** The tab being presented, or null when present mode is off. */
    presentingTabId: string | null
    /** Shows the tab as slides, full screen. */
    present: (tabId: string) => void
    /**
     * Leaves present mode and full screen: the one way out that Esc, Close, the tab closing, a crash, a window
     * close request and the view unmounting all go through. Does nothing when present mode is off. Resolves once
     * the window has left full screen.
     */
    exit: () => Promise<void>
}

const PresentModeContext = createContext<PresentMode | null>(null)

/** Present mode, or null outside a PresentModeProvider (the recovery screen, which has no slides to leave). */
export function useOptionalPresentMode(): PresentMode | null {
    return useContext(PresentModeContext)
}

/** Outside a provider (a part of the studio drawn on its own), present mode is off and never starts. */
const NO_PRESENT_MODE: PresentMode = { presentingTabId: null, present: () => {}, exit: async () => {} }

export function usePresentMode(): PresentMode {
    return useOptionalPresentMode() ?? NO_PRESENT_MODE
}

/**
 * Whether present mode is on, and which tab it shows. The slides themselves are drawn by PresentModeView, inside the
 * layout, where the preview's per-tab memory (the "Load images" choice) is. `fullscreen` is for tests.
 */
export function PresentModeProvider({ children, fullscreen: givenFullscreen }: { children: ReactNode; fullscreen?: PresentFullscreen }) {
    const [presentingTabId, setPresentingTabId] = useState<string | null>(null)
    const [fullscreen] = useState(() => givenFullscreen ?? createPresentFullscreen())

    const present = useCallback(
        (tabId: string) => {
            setPresentingTabId(tabId)
            void fullscreen.enter()
        },
        [fullscreen]
    )

    const exit = useCallback(() => {
        setPresentingTabId(null)
        return fullscreen.leave()
    }, [fullscreen])

    // The whole studio going (a crash it can't recover from, or a reload) still puts the window back.
    useEffect(() => () => void fullscreen.leave(), [fullscreen])

    const value = useMemo(() => ({ presentingTabId, present, exit }), [presentingTabId, present, exit])
    return <PresentModeContext.Provider value={value}>{children}</PresentModeContext.Provider>
}
