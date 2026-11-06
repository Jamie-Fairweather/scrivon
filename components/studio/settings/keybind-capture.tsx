'use client'

import { useEffect, useRef } from 'react'
import { normalizeChord } from '@/lib/settings/chord-utils'
import { describeDisallowedChord } from '@/lib/settings/conflicts'
import { formatChord } from '@/lib/settings/format-keybind'
import type { KeybindChord } from '@/lib/settings/types'
import { Button } from '@/components/ui/button'

type KeybindCaptureProps = {
    active: boolean
    onCapture: (chord: KeybindChord | null) => void
    onCancel: () => void
    /** Called with a short reason when the pressed chord can't be a shortcut; recording carries on. */
    onReject: (message: string) => void
}

function isModifierOnly(event: KeyboardEvent): boolean {
    return event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta'
}

export function KeybindCapture({ active, onCapture, onCancel, onReject }: KeybindCaptureProps) {
    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!active) return
        buttonRef.current?.focus()
    }, [active])

    useEffect(() => {
        if (!active) return

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopImmediatePropagation()

            // Esc, and plain Tab / Shift+Tab (the usual way to move on), stop recording instead of being recorded.
            const isPlainTab = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey
            if (event.key === 'Escape' || isPlainTab) {
                onCancel()
                return
            }

            if (isModifierOnly(event)) return

            const chord = normalizeChord({
                key: event.key,
                ctrl: event.ctrlKey || undefined,
                meta: event.metaKey || undefined,
                shift: event.shiftKey || undefined,
                alt: event.altKey || undefined,
            })

            const problem = describeDisallowedChord(chord)
            if (problem) {
                onReject(problem)
                return
            }

            onCapture(chord)
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [active, onCapture, onCancel, onReject])

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
