'use client'

import { useEffect, useRef } from 'react'
import { matchKeybind } from '@/lib/settings/match-keybind'
import type { KeybindActionId, KeybindBindings } from '@/lib/settings/types'

export type KeybindHandlers = Partial<Record<KeybindActionId, () => boolean | void>>

export function useGlobalKeybinds(bindings: KeybindBindings, handlers: KeybindHandlers, options: { enabled?: boolean; hasWorkspace?: boolean } = {}) {
    const { enabled = true, hasWorkspace = false } = options
    const handlersRef = useRef(handlers)

    useEffect(() => {
        handlersRef.current = handlers
    }, [handlers])

    useEffect(() => {
        if (!enabled) return

        const handleKeyDown = (event: KeyboardEvent) => {
            const actionId = matchKeybind(event, bindings, { hasWorkspace })
            if (!actionId) return

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
