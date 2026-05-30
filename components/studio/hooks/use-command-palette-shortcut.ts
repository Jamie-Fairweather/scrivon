'use client'

import { useEffect } from 'react'
import type { PaletteMode } from '@/components/studio/command-palette/types'

function isNativeTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useCommandPaletteShortcut(isDesktop: boolean, openPalette: (mode?: PaletteMode) => void) {
    useEffect(() => {
        if (!isDesktop) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'F1') {
                event.preventDefault()
                openPalette('all')
                return
            }

            if (!event.shiftKey || (!event.ctrlKey && !event.metaKey)) return
            if (event.altKey) return
            if (isNativeTextField(event.target)) return

            const key = event.key.toLowerCase()

            if (key === 'f') {
                event.preventDefault()
                openPalette('text')
                return
            }

            if (key === 'n') {
                event.preventDefault()
                openPalette('files')
            }
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [isDesktop, openPalette])
}
