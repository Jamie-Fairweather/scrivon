'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Menus, the menu bar and dialogs (the palette among them). A command chosen in one of them runs as it closes, so a
 * dialog it opens can't give focus back there: it goes back to where focus was before.
 */
const PASSING_FOCUS = '[data-slot="menu-popup"], [role="menubar"], [data-slot$="dialog-popup"]'

function isPassingFocus(el: Element): boolean {
    return el.closest(PASSING_FOCUS) !== null
}

/** True when `el` can take focus now: still on the page, drawn, and not in a hidden (inert) pane. */
export function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
    if (!el?.isConnected || el.closest('[inert]')) return false
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })
}

/**
 * Where a dialog opened from a command gives focus back when it closes: the element that had it, or, when the command
 * came from a menu, the menu bar or the palette, where focus last rested before that. Call `remember` as the dialog
 * opens, and use `returnTarget` as the dialog's `finalFocus` (true lets the dialog choose, when that place has gone).
 */
export function useFocusReturn(): { remember: () => void; returnTarget: () => HTMLElement | true } {
    // Where focus last rested outside a menu, the menu bar or a dialog.
    const restingFocusRef = useRef<HTMLElement | null>(null)
    const returnFocusRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target
            if (target instanceof HTMLElement && target !== document.body && !isPassingFocus(target)) restingFocusRef.current = target
        }
        document.addEventListener('focusin', onFocusIn)
        return () => document.removeEventListener('focusin', onFocusIn)
    }, [])

    const remember = useCallback(() => {
        const active = document.activeElement
        returnFocusRef.current =
            active instanceof HTMLElement && active !== document.body && !isPassingFocus(active) ? active : restingFocusRef.current
    }, [])

    const returnTarget = useCallback(() => {
        const previous = returnFocusRef.current
        return canTakeFocus(previous) ? previous : true
    }, [])

    return { remember, returnTarget }
}
