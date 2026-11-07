'use client'

import { useEffect, useRef } from 'react'
import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { matchKeybind } from '@/lib/settings/match-keybind'
import type { KeybindActionId, KeybindBindings } from '@/lib/settings/types'

export type KeybindHandlers = Partial<Record<KeybindActionId, () => boolean | void>>

// Base UI marks an open dialog's popup with data-open. Toasts are role="dialog" too but say
// aria-modal="false", and Monaco's find widget is role="dialog" without data-open.
const OPEN_MODAL_SELECTOR = [
    '[role="dialog"][data-open]:not([aria-modal="false"])',
    '[role="alertdialog"][data-open]:not([aria-modal="false"])',
].join(', ')

const COMMAND_PALETTE_SELECTOR = '[data-slot="command-dialog-popup"]'

/**
 * Which modal is open. App shortcuts must not act behind one (Settings, confirmations, prompts),
 * but palette shortcuts still work while only the command palette is open, so F1 can switch it
 * back to all commands.
 */
function openModal(): 'none' | 'palette' | 'other' {
    if (typeof document === 'undefined') return 'none'
    const open = [...document.querySelectorAll(OPEN_MODAL_SELECTOR)]
    if (open.length === 0) return 'none'
    return open.every((element) => element.matches(COMMAND_PALETTE_SELECTOR)) ? 'palette' : 'other'
}

/** True when the key was pressed inside the open command palette, which keeps focus in its search box. */
function isInOpenPalette(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(`${COMMAND_PALETTE_SELECTOR}[data-open]`) !== null
}

export function useGlobalKeybinds(bindings: KeybindBindings, handlers: KeybindHandlers, options: { enabled?: boolean; hasWorkspace?: boolean } = {}) {
    const { enabled = true, hasWorkspace = false } = options
    const handlersRef = useRef(handlers)

    useEffect(() => {
        handlersRef.current = handlers
    }, [handlers])

    useEffect(() => {
        if (!enabled) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return
            const modal = openModal()
            if (modal === 'other') return

            const actionId = matchKeybind(event, bindings, { hasWorkspace, inPalette: isInOpenPalette(event.target) })
            if (!actionId) return
            if (modal === 'palette' && !getKeybindActionMeta(actionId)?.allowInPalette) return

            const handler = handlersRef.current[actionId]
            if (!handler) return

            const handled = handler()
            if (handled === false) return

            event.preventDefault()
            event.stopPropagation()
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [bindings, enabled, hasWorkspace])
}
