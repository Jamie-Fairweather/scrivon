'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
    /**
     * Where focus goes back to on the way out: what had it when Present was chosen or, when that was a menu or the
     * command palette, what had it before them. Null when that has gone or is hidden. Answers once per presenting.
     */
    takeReturnFocus: () => HTMLElement | null
}

const PresentModeContext = createContext<PresentMode | null>(null)

/** Present mode, or null outside a PresentModeProvider (the recovery screen, which has no slides to leave). */
export function useOptionalPresentMode(): PresentMode | null {
    return useContext(PresentModeContext)
}

/** Outside a provider (a part of the studio drawn on its own), present mode is off and never starts. */
const NO_PRESENT_MODE: PresentMode = { presentingTabId: null, present: () => {}, exit: async () => {}, takeReturnFocus: () => null }

export function usePresentMode(): PresentMode {
    return useOptionalPresentMode() ?? NO_PRESENT_MODE
}

/**
 * The menus, the command palette and other dialogs. They close as Present runs, or just before, so focus can't go
 * back to them. Present mode's own popup is a dialog too.
 */
const PASSING_FOCUS = '[role="menubar"], [role="menu"], [role="dialog"], [role="alertdialog"]'

/** An element focus can go back to: somewhere in the studio itself, not a menu or a dialog. */
function isStudioFocus(el: EventTarget | null): el is HTMLElement {
    return el instanceof HTMLElement && el !== document.body && el.closest(PASSING_FOCUS) === null
}

/** True when `el` can take focus now: still on the page, drawn, and not in a hidden (inert) pane. */
function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
    if (!el?.isConnected || el.closest('[inert]')) return false
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })
}

/**
 * Whether present mode is on, and which tab it shows. The slides themselves are drawn by PresentModeView, inside the
 * layout, where the preview's per-tab memory (the "Load images" choice) is. `fullscreen` is for tests.
 */
export function PresentModeProvider({ children, fullscreen: givenFullscreen }: { children: ReactNode; fullscreen?: PresentFullscreen }) {
    const [presentingTabId, setPresentingTabId] = useState<string | null>(null)
    const [fullscreen] = useState(() => givenFullscreen ?? createPresentFullscreen())
    // The last place in the studio that had focus, for when Present is chosen from a menu or the palette.
    const lastStudioFocusRef = useRef<HTMLElement | null>(null)
    const returnFocusRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            if (isStudioFocus(event.target)) lastStudioFocusRef.current = event.target
        }
        document.addEventListener('focusin', onFocusIn)
        return () => document.removeEventListener('focusin', onFocusIn)
    }, [])

    const present = useCallback(
        (tabId: string) => {
            const active = document.activeElement
            returnFocusRef.current = isStudioFocus(active) ? active : lastStudioFocusRef.current
            setPresentingTabId(tabId)
            void fullscreen.enter()
        },
        [fullscreen]
    )

    const exit = useCallback(() => {
        setPresentingTabId(null)
        return fullscreen.leave()
    }, [fullscreen])

    const takeReturnFocus = useCallback(() => {
        const target = returnFocusRef.current
        returnFocusRef.current = null
        return canTakeFocus(target) ? target : null
    }, [])

    // The whole studio going (a crash it can't recover from, or a reload) still puts the window back.
    useEffect(() => () => void fullscreen.leave(), [fullscreen])

    const value = useMemo(() => ({ presentingTabId, present, exit, takeReturnFocus }), [presentingTabId, present, exit, takeReturnFocus])
    return <PresentModeContext.Provider value={value}>{children}</PresentModeContext.Provider>
}
