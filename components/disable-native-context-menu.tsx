'use client'

import { useEffect } from 'react'

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea'
}

export function DisableNativeContextMenu() {
    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            // Prevent the browser/Tauri default context menu. We still allow our own menus.
            // If you ever want to allow native menus in inputs, flip this condition.
            if (isEditableTarget(e.target)) {
                e.preventDefault()
                return
            }
            e.preventDefault()
        }

        window.addEventListener('contextmenu', onContextMenu, { capture: true })
        return () => window.removeEventListener('contextmenu', onContextMenu, { capture: true } as unknown as boolean)
    }, [])

    return null
}
