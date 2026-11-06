'use client'

import { useEffect, useRef, useState } from 'react'
import { KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import type { KeybindActionId, KeybindChord } from '@/lib/settings/types'
import { KeybindCapture, KeybindDisplay } from '@/components/studio/settings/keybind-capture'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'

export function KeyboardSettings() {
    const { settings, setKeybindChords, resetKeybind, resetAllKeybinds } = useAppSettings()
    const [editingId, setEditingId] = useState<KeybindActionId | null>(null)
    const [error, setError] = useState<string | null>(null)
    const editButtons = useRef(new Map<KeybindActionId, HTMLButtonElement>())
    const returnFocusTo = useRef<KeybindActionId | null>(null)

    // The recorder button goes away when recording ends, so put focus back on that row's Edit button.
    useEffect(() => {
        if (editingId !== null) return
        const actionId = returnFocusTo.current
        returnFocusTo.current = null
        if (actionId) editButtons.current.get(actionId)?.focus()
    }, [editingId])

    const stopRecording = (actionId: KeybindActionId) => {
        returnFocusTo.current = actionId
        setEditingId(null)
    }

    const handleCapture = (actionId: KeybindActionId, chord: KeybindChord | null) => {
        // Stop recording even when the chord is refused, so the next key (often Tab) is never recorded by mistake.
        setError(chord ? setKeybindChords(actionId, [chord]) : null)
        stopRecording(actionId)
    }

    const handleClear = (actionId: KeybindActionId) => {
        setError(null)
        setKeybindChords(actionId, [])
        setEditingId(null)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">Click Edit to rebind a shortcut. Press Esc or Tab to cancel recording.</p>
                <Button type="button" variant="outline" size="sm" onClick={resetAllKeybinds}>
                    Reset all
                </Button>
            </div>

            {error ? <p className="text-sm text-destructive-foreground">{error}</p> : null}

            <div className="divide-y divide-border rounded-lg border border-border">
                {KEYBIND_ACTIONS.map((action) => {
                    const chords = settings.keybinds[action.id] ?? []
                    const isEditing = editingId === action.id

                    return (
                        <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{action.label}</p>
                                <p className="text-xs text-muted-foreground">{action.category}</p>
                            </div>

                            <div className="flex items-center gap-2">
                                {isEditing ? (
                                    <KeybindCapture
                                        active
                                        onCapture={(chord) => handleCapture(action.id, chord)}
                                        onCancel={() => {
                                            setError(null)
                                            stopRecording(action.id)
                                        }}
                                        onReject={setError}
                                    />
                                ) : (
                                    <KeybindDisplay chords={chords} />
                                )}

                                {!isEditing ? (
                                    <>
                                        <Button
                                            ref={(node: HTMLButtonElement | null) => {
                                                if (node) editButtons.current.set(action.id, node)
                                                else editButtons.current.delete(action.id)
                                            }}
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setEditingId(action.id)}
                                        >
                                            Edit
                                        </Button>
                                        {chords.length > 0 ? (
                                            <Button type="button" size="sm" variant="ghost" onClick={() => handleClear(action.id)}>
                                                Clear
                                            </Button>
                                        ) : null}
                                        <Button type="button" size="sm" variant="ghost" onClick={() => resetKeybind(action.id)}>
                                            Reset
                                        </Button>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
