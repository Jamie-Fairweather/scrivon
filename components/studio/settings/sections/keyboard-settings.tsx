'use client'

import { useState } from 'react'
import { KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import type { KeybindActionId, KeybindChord } from '@/lib/settings/types'
import { KeybindCapture, KeybindDisplay } from '@/components/studio/settings/keybind-capture'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'

export function KeyboardSettings() {
    const { settings, setKeybindChords, resetKeybind, resetAllKeybinds } = useAppSettings()
    const [editingId, setEditingId] = useState<KeybindActionId | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleCapture = (actionId: KeybindActionId, chord: KeybindChord | null) => {
        if (!chord) {
            setEditingId(null)
            return
        }

        const message = setKeybindChords(actionId, [chord])
        if (message) {
            setError(message)
            return
        }

        setError(null)
        setEditingId(null)
    }

    const handleClear = (actionId: KeybindActionId) => {
        setError(null)
        setKeybindChords(actionId, [])
        setEditingId(null)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">Click Edit to rebind a shortcut. Press Esc to cancel recording.</p>
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
                                            setEditingId(null)
                                            setError(null)
                                        }}
                                    />
                                ) : (
                                    <KeybindDisplay chords={chords} />
                                )}

                                {!isEditing ? (
                                    <>
                                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(action.id)}>
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
