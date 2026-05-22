'use client'

import { useEffect } from 'react'
import { useDocumentSave, useDocumentTabs } from '@/components/studio/workspace-provider'

function isNativeTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useSaveShortcut() {
    const { activeTabId } = useDocumentTabs()
    const { flushSave } = useDocumentSave()

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 's' || (!event.ctrlKey && !event.metaKey)) return
            if (event.shiftKey || event.altKey) return
            if (!activeTabId) return
            if (isNativeTextField(event.target)) return

            event.preventDefault()
            void flushSave(activeTabId)
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [activeTabId, flushSave])
}
