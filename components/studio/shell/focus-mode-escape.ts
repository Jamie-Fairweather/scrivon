'use client'

import { useEffect, useRef } from 'react'
import { isComposingKeyEvent } from '@/lib/settings/chord-utils'

/**
 * What Esc closes instead of leaving focus mode, while focus is inside it: a dialog (the palette, Settings, a
 * notification, Monaco's find box), a menu or the menu bar, or a list.
 */
const OWNS_ESCAPE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"]'

/**
 * A dialog, popover, menu or list that is open, wherever focus is. Notifications say aria-modal="false" and
 * don't count: they stay up on their own.
 */
const OPEN_POPUP = [
    '[role="dialog"][data-open]:not([aria-modal="false"])',
    '[role="alertdialog"][data-open]:not([aria-modal="false"])',
    '[role="menu"][data-open]',
    '[role="listbox"][data-open]',
].join(', ')

/**
 * Monaco's hover over a word or a mistake. It hides on any key without marking the key as used, so it is checked
 * before the key reaches the editor.
 */
const EDITOR_HOVER = '.monaco-editor .monaco-hover:not(.hidden)'

/** What was on screen as the key went down, before anything handled it. */
export type EscapeSnapshot = {
    /** A dialog, menu or list was open. */
    popupOpen: boolean
    /** Monaco's hover was showing. */
    editorHoverShown: boolean
}

export function escapeSnapshot(doc: Document): EscapeSnapshot {
    return { popupOpen: doc.querySelector(OPEN_POPUP) !== null, editorHoverShown: doc.querySelector(EDITOR_HOVER) !== null }
}

export type EscapeKey = {
    key: string
    defaultPrevented: boolean
    repeat?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    isComposing?: boolean
    keyCode?: number
    target: EventTarget | null
}

/**
 * Whether this key press leaves focus mode: a plain Esc that nothing else used. Monaco marks Esc as used
 * (defaultPrevented) when it clears a selection or multiple cursors, leaves a snippet, or closes its find box,
 * suggestions, parameter hints, quick-fix list (spelling) or problem widget (F8). Esc that ends an IME
 * composition, or that a dialog, menu, list or Monaco's hover takes, doesn't leave either.
 */
export function escapeLeavesFocusMode(event: EscapeKey, before: EscapeSnapshot): boolean {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return false
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false
    if (isComposingKeyEvent(event)) return false
    if (before.popupOpen || before.editorHoverShown) return false
    return !(event.target instanceof Element && event.target.closest(OWNS_ESCAPE) !== null)
}

/**
 * Esc leaves focus mode from anywhere in the window, the empty editor area too. App shortcuts can't have Esc
 * (chord-utils.ts), so it has its own listener on the window, after the key has reached everything else.
 */
export function useLeaveFocusModeOnEscape(active: boolean, leave: () => void): void {
    const leaveRef = useRef(leave)
    useEffect(() => {
        leaveRef.current = leave
    }, [leave])

    useEffect(() => {
        if (!active) return
        let before: EscapeSnapshot = { popupOpen: false, editorHoverShown: false }
        // Before the key reaches anything: closing a menu or Monaco's hover changes the page before it bubbles up.
        const onKeyDownCapture = (event: KeyboardEvent) => {
            if (event.key === 'Escape') before = escapeSnapshot(document)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (!escapeLeavesFocusMode(event, before)) return
            event.preventDefault()
            leaveRef.current()
        }
        window.addEventListener('keydown', onKeyDownCapture, { capture: true })
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDownCapture, { capture: true })
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [active])
}
