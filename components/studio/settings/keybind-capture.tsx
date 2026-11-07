'use client'

import { useEffect, useRef } from 'react'
import { isComposingKeyEvent, isModifierKey, normalizeChord, physicalKeyFallback, typesAltGraphCharacter } from '@/lib/settings/chord-utils'
import { describeDisallowedChord } from '@/lib/settings/conflicts'
import { formatChords } from '@/lib/settings/format-keybind'
import type { KeybindChord } from '@/lib/settings/types'
import { Button } from '@/components/ui/button'

type KeybindCaptureProps = {
    active: boolean
    /** The action being recorded, for screen readers. */
    label: string
    onCapture: (chord: KeybindChord | null) => void
    /**
     * Called on Esc, Tab, or a click on the recorder or Cancel (refocus true), and when focus moves
     * to another control (refocus false, so focus stays where the user put it). When focus goes
     * nowhere (the window loses focus, or a click on blank space), refocus is true too, so the
     * user comes back to the row instead of the start of the dialog.
     */
    onCancel: (refocus: boolean) => void
    /** Called with a short reason when the pressed chord can't be a shortcut; recording carries on. */
    onReject: (message: string) => void
}

export function KeybindCapture({ active, label, onCapture, onCancel, onReject }: KeybindCaptureProps) {
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
                onCancel(true)
                return
            }

            // Modifiers wait for the real key; IME keystrokes belong to the text being composed.
            if (isModifierKey(event.key) || isComposingKeyEvent(event)) return

            if (typesAltGraphCharacter(event)) {
                onReject('That combination types a character on your keyboard layout')
                return
            }

            const chord = normalizeChord({
                // Record the physical key on non-Latin layouts and for Shift+digit, so it matches on any layout.
                key: physicalKeyFallback(event) ?? event.key,
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

    // Keys are read from the window, so the recorder only holds focus; clicking it or moving away cancels.
    return (
        <>
            <Button
                ref={buttonRef}
                type="button"
                size="sm"
                variant="outline"
                className="min-w-36 motion-safe:animate-pulse"
                onClick={() => onCancel(true)}
                onBlur={(event) => onCancel(event.relatedTarget === null)}
            >
                Press shortcut…<span className="sr-only"> for {label}. Esc cancels.</span>
            </Button>
            {/* Keeps focus on the recorder when pressed, so the click cancels and focus goes back to Edit. */}
            <Button type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => onCancel(true)}>
                Cancel
            </Button>
        </>
    )
}

export function KeybindDisplay({ chords }: { chords: KeybindChord[] }) {
    if (chords.length === 0) {
        return <span className="text-sm text-muted-foreground">Not assigned</span>
    }

    return <span className="font-mono text-sm text-muted-foreground">{formatChords(chords)}</span>
}
