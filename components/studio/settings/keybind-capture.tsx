'use client'

import { useEffect, useRef } from 'react'
import { normalizeChord } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import type { KeybindChord } from '@/lib/settings/types'
import { Button } from '@/components/ui/button'

type KeybindCaptureProps = {
    active: boolean
    onCapture: (chord: KeybindChord | null) => void
    onCancel: () => void
}

function isModifierOnly(event: KeyboardEvent): boolean {
    return event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta'
}

export function KeybindCapture({ active, onCapture, onCancel }: KeybindCaptureProps) {
    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!active) return
        buttonRef.current?.focus()
    }, [active])

    useEffect(() => {
        if (!active) return

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopPropagation()

            if (event.key === 'Escape') {
                onCancel()
                return
            }

            if (isModifierOnly(event)) return

            onCapture(
                normalizeChord({
                    key: event.key,
                    ctrl: event.ctrlKey || undefined,
                    meta: event.metaKey || undefined,
                    shift: event.shiftKey || undefined,
                    alt: event.altKey || undefined,
                })
            )
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [active, onCapture, onCancel])

    if (!active) return null

    return (
        <Button ref={buttonRef} type="button" size="sm" variant="outline" className="min-w-36 animate-pulse">
            Press shortcut…
        </Button>
    )
}

export function KeybindDisplay({ chords }: { chords: KeybindChord[] }) {
    if (chords.length === 0) {
        return <span className="text-sm text-muted-foreground">Not assigned</span>
    }

    return <span className="font-mono text-sm text-muted-foreground">{chords.map((chord) => formatChord(chord)).join(' ')}</span>
}
