'use client'

import { useEffect, type RefObject } from 'react'

const OPEN_MODAL_SELECTOR = '[data-slot$="dialog-popup"]'
const OPEN_MENU_SELECTOR = '[role="menu"]'

function isPlainKey(event: KeyboardEvent): boolean {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey
}

/**
 * Windows-style keyboard access to the custom menu bar: pressing and releasing Alt on its own,
 * or pressing F10, moves focus to the first menu. Doing it again, or pressing Escape while a
 * menu title is focused, puts focus back where it was. Ignored while a dialog is open.
 */
export function useMenubarAccessKey(menubarRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        let altAlone = false
        let returnFocusTo: HTMLElement | null = null

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
            const target = returnFocusTo
            returnFocusTo = null
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
            returnFocusTo = active instanceof HTMLElement && active !== document.body ? active : null
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
            if (event.key !== 'Alt') return
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
            if (menubar()?.contains(target) || target.closest(OPEN_MENU_SELECTOR)) return
            // Focus moved somewhere else on its own (Tab, click), so there is nothing to go back to.
            if (target !== returnFocusTo) returnFocusTo = null
        }

        window.addEventListener('keydown', trackAlt, true)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp, true)
        window.addEventListener('pointerdown', cancelAlt, true)
        window.addEventListener('blur', cancelAlt)
        document.addEventListener('focusin', onFocusIn)

        return () => {
            window.removeEventListener('keydown', trackAlt, true)
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp, true)
            window.removeEventListener('pointerdown', cancelAlt, true)
            window.removeEventListener('blur', cancelAlt)
            document.removeEventListener('focusin', onFocusIn)
        }
    }, [menubarRef])
}
