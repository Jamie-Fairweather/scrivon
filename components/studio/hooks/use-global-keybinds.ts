'use client'

import { useEffect, useRef } from 'react'
import { isMacPlatform, isModifierKey, physicalKeyFallback } from '@/lib/settings/chord-utils'
import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { isInsideCodeEditor, matchKeybinds } from '@/lib/settings/match-keybind'
import type { KeybindActionId, KeybindBindings } from '@/lib/settings/types'

/** Each returns false to turn the key down, which passes it on to the next action with those keys (or the page). */
export type KeybindHandlers = Partial<Record<KeybindActionId, () => boolean | void>>

// Base UI marks an open dialog's popup with data-open. Toasts are role="dialog" too but say
// aria-modal="false", and Monaco's find widget is role="dialog" without data-open. A popover is
// role="dialog" with data-open but isn't modal, and Base UI doesn't say so, so it is left out by name.
const OPEN_MODAL_SELECTOR = [
    '[role="dialog"][data-open]:not([aria-modal="false"]):not([data-slot="popover-popup"])',
    '[role="alertdialog"][data-open]:not([aria-modal="false"])',
].join(', ')

const COMMAND_PALETTE_SELECTOR = '[data-slot="command-dialog-popup"]'

/** How long Monaco waits for the second key after Ctrl+K. */
const EDITOR_KEY_PAIR_MS = 5000

/** The app counts these as modifiers, but Monaco takes them as the second key of a pair. */
const LOCK_KEYS = new Set(['CapsLock', 'NumLock', 'ScrollLock'])

/**
 * Which modal is open. App shortcuts must not act behind one (Settings, confirmations, prompts),
 * but palette shortcuts still work while only the command palette is open, so F1 can switch it
 * back to all commands. Zoom works behind any of them (allowInModal).
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

/** Monaco's two-key shortcuts (Ctrl+K Ctrl+0 folds all…) all start with Ctrl+K, Cmd+K on a Mac. */
function startsEditorKeyPair(event: KeyboardEvent, isMac: boolean): boolean {
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    const key = physicalKeyFallback(event) ?? event.key
    return mod && !event.shiftKey && !event.altKey && key.toLowerCase() === 'k' && isInsideCodeEditor(event.target)
}

export function useGlobalKeybinds(bindings: KeybindBindings, handlers: KeybindHandlers, options: { enabled?: boolean; hasWorkspace?: boolean } = {}) {
    const { enabled = true, hasWorkspace = false } = options
    const handlersRef = useRef(handlers)

    useEffect(() => {
        handlersRef.current = handlers
    }, [handlers])

    useEffect(() => {
        if (!enabled) return
        const isMac = isMacPlatform()
        // Until when the editor takes the next key as the second of a pair, after a Ctrl+K the app passed on.
        let keyPairUntil = 0
        // The key whose first press the app took. Its repeats are stopped too, so they never reach the editor.
        let heldKey: string | null = null

        /** Runs the first action that takes the key, and says whether one did. */
        const runAction = (event: KeyboardEvent): boolean => {
            const actionIds = matchKeybinds(event, bindings, { hasWorkspace, inPalette: isInOpenPalette(event.target) })
            if (actionIds.length === 0) return false
            // Only now look for open dialogs: that walks the whole page, too much for every key typed in the editor.
            const modal = openModal()

            for (const actionId of actionIds) {
                const meta = getKeybindActionMeta(actionId)
                if (modal === 'other' && !meta?.allowInModal) continue
                if (modal === 'palette' && !meta?.allowInPalette) continue
                const handler = handlersRef.current[actionId]
                if (handler && handler() !== false) return true
            }
            return false
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.code || event.key
            if (!event.repeat) heldKey = null
            if (event.defaultPrevented) return

            if (keyPairUntil > 0 && (!isModifierKey(event.key) || LOCK_KEYS.has(event.key))) {
                if (Date.now() >= keyPairUntil) {
                    keyPairUntil = 0
                } else if (isInsideCodeEditor(event.target)) {
                    // The second key. Monaco only hears keys inside the editor, so it waits on through keys pressed elsewhere.
                    keyPairUntil = 0
                    return
                }
            }

            // A held key only runs actions that are meant to repeat (matchKeybinds), but the rest are still the app's.
            const taken = runAction(event) || (event.repeat && heldKey === key)
            if (taken) {
                if (!event.repeat) heldKey = key
                event.preventDefault()
                event.stopPropagation()
                return
            }
            if (startsEditorKeyPair(event, isMac)) keyPairUntil = Date.now() + EDITOR_KEY_PAIR_MS
        }

        // Monaco stops waiting once the window loses focus.
        const handleBlur = () => {
            keyPairUntil = 0
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        window.addEventListener('blur', handleBlur)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, { capture: true })
            window.removeEventListener('blur', handleBlur)
        }
    }, [bindings, enabled, hasWorkspace])
}
