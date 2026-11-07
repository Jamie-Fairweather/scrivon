'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'

const OPEN_MODAL_SELECTOR = '[data-slot$="dialog-popup"]'
const OPEN_MENU_SELECTOR = '[role="menu"]'

function isPlainKey(event: KeyboardEvent): boolean {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey
}

/** True when `el` can take focus now: still on the page, drawn, and not in a hidden (inert) pane like the editor. */
function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
    if (!el?.isConnected || el.closest('[inert]')) return false
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })
}

/**
 * Windows-style keyboard access to the custom menu bar: pressing and releasing Alt on its own,
 * or pressing F10, moves focus to the first menu. Doing it again, or pressing Escape while a
 * menu title is focused, puts focus back where it was. Ignored while a dialog is open.
 *
 * Returns the `finalFocus` for a menu closed by choosing a command: focus goes back to where it was
 * before the menu bar (also after a click on a menu title), as in Windows apps, not to the menu title.
 */
export function useMenubarAccessKey(menubarRef: RefObject<HTMLElement | null>): () => HTMLElement | boolean {
    // Where focus was before it moved to the menu bar, to go back to afterwards.
    const returnFocusToRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        let altAlone = false

        const menubar = () => menubarRef.current
        const focusInMenubar = () => {
            const bar = menubar()
            return Boolean(bar && document.activeElement && bar.contains(document.activeElement))
        }
        const blocked = () => {
            if (document.querySelector(OPEN_MODAL_SELECTOR)) return true
            const active = document.activeElement
            return Boolean(active?.closest(OPEN_MENU_SELECTOR))
        }

        const leaveMenubar = () => {
            const target = returnFocusToRef.current
            returnFocusToRef.current = null
            if (target?.isConnected) {
                target.focus()
            } else if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
            }
        }

        const toggleMenubar = () => {
            if (focusInMenubar()) {
                leaveMenubar()
                return
            }
            const first = menubar()?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
            if (!first) return
            const active = document.activeElement
            returnFocusToRef.current = active instanceof HTMLElement && active !== document.body ? active : null
            first.focus()
        }

        // Capture phase: only watches whether Alt is pressed and released with no other key in between,
        // so the editor or other handlers can't hide that from us.
        const trackAlt = (event: KeyboardEvent) => {
            altAlone = event.key === 'Alt' ? isPlainKey(event) && !event.repeat : false
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return

            if (event.key === 'F10' && isPlainKey(event) && !event.altKey) {
                if (blocked()) return
                event.preventDefault()
                toggleMenubar()
                return
            }

            if (event.key === 'Escape' && focusInMenubar() && !blocked()) {
                event.preventDefault()
                leaveMenubar()
            }
        }

        const onKeyUp = (event: KeyboardEvent) => {
            // Some keys only reach the page as a keyup (PrintScreen in Alt+PrtSc), so any other key cancels too.
            if (event.key !== 'Alt') {
                altAlone = false
                return
            }
            const wasAlone = altAlone
            altAlone = false
            if (!wasAlone || blocked()) return
            event.preventDefault()
            toggleMenubar()
        }

        const cancelAlt = () => {
            altAlone = false
        }

        const onFocusIn = (event: FocusEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const bar = menubar()
            if (bar?.contains(target)) {
                // Arriving from the page (a click on a menu title): remember where from, unless Alt or F10 already did.
                const from = event.relatedTarget
                if (
                    !returnFocusToRef.current &&
                    from instanceof HTMLElement &&
                    from !== document.body &&
                    !bar.contains(from) &&
                    !from.closest(OPEN_MENU_SELECTOR)
                ) {
                    returnFocusToRef.current = from
                }
                return
            }
            if (target.closest(OPEN_MENU_SELECTOR)) return
            // Focus moved somewhere else on its own (Tab, click), so there is nothing to go back to.
            if (target !== returnFocusToRef.current) returnFocusToRef.current = null
        }

        window.addEventListener('keydown', trackAlt, true)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp, true)
        window.addEventListener('pointerdown', cancelAlt, true)
        // Alt+wheel is the editor's fast scroll, not a menu shortcut.
        window.addEventListener('wheel', cancelAlt, { capture: true, passive: true })
        window.addEventListener('blur', cancelAlt)
        document.addEventListener('focusin', onFocusIn)

        return () => {
            window.removeEventListener('keydown', trackAlt, true)
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp, true)
            window.removeEventListener('pointerdown', cancelAlt, true)
            window.removeEventListener('wheel', cancelAlt, true)
            window.removeEventListener('blur', cancelAlt)
            document.removeEventListener('focusin', onFocusIn)
        }
    }, [menubarRef])

    return useCallback(() => {
        const active = document.activeElement
        // The command moved focus on (into a dialog it opened, say), so leave it there.
        if (active && active !== document.body && !menubarRef.current?.contains(active) && !active.closest(OPEN_MENU_SELECTOR)) return false
        const target = returnFocusToRef.current
        returnFocusToRef.current = null
        // true: Base UI's own choice, the menu title (also when the command hid where focus was, as Preview Only does).
        return canTakeFocus(target) ? target : true
    }, [menubarRef])
}
