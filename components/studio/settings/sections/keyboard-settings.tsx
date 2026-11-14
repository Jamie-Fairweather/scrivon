'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { chordListsEqual, isMacPlatform } from '@/lib/settings/chord-utils'
import { describeEditorChordClash, editorActionsSharingKeys, findKeybindConflicts } from '@/lib/settings/conflicts'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { formatChord, formatChords } from '@/lib/settings/format-keybind'
import { getKeybindActionMeta, KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import type { KeybindActionId, KeybindChord } from '@/lib/settings/types'
import { KeybindCapture, KeybindDisplay } from '@/components/studio/settings/keybind-capture'
import { useAppSettings, type KeybindRefusal } from '@/components/studio/settings/settings-provider'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function KeyboardSettings() {
    const { settings, setKeybindChords, resetKeybind, reassignKeybind, resetAllKeybinds } = useAppSettings()
    const [editingId, setEditingId] = useState<KeybindActionId | null>(null)
    // Follows editingId straight away, so a late cancel (the recorder losing focus as it goes away) is ignored.
    const editingRef = useRef<KeybindActionId | null>(null)
    // Shown in the row it belongs to.
    const [error, setError] = useState<(KeybindRefusal & { actionId: KeybindActionId }) | null>(null)
    const editButtons = useRef(new Map<KeybindActionId, HTMLButtonElement>())
    const returnFocusTo = useRef<KeybindActionId | null>(null)
    const conflicts = useMemo(() => findKeybindConflicts(settings.keybinds), [settings.keybinds])
    const defaults = useMemo(() => createDefaultKeybinds(isMacPlatform()), [])

    /** Labels of the other actions that share a chord with this one. */
    const sharedWith = (actionId: KeybindActionId): string[] =>
        KEYBIND_ACTIONS.filter(
            (other) =>
                other.id !== actionId && conflicts.some((conflict) => conflict.actionIds.includes(actionId) && conflict.actionIds.includes(other.id))
        ).map((other) => other.label)

    // The recorder button goes away when recording ends, so put focus back on that row's Edit button.
    useEffect(() => {
        if (editingId !== null) return
        const actionId = returnFocusTo.current
        returnFocusTo.current = null
        if (actionId) editButtons.current.get(actionId)?.focus()
    }, [editingId])

    const showError = (actionId: KeybindActionId, refusal: KeybindRefusal | null) => {
        setError(refusal ? { ...refusal, actionId } : null)
    }

    const focusEdit = (actionId: KeybindActionId) => editButtons.current.get(actionId)?.focus()

    const startRecording = (actionId: KeybindActionId) => {
        setError(null)
        editingRef.current = actionId
        setEditingId(actionId)
    }

    const stopRecording = (actionId: KeybindActionId, refocus = true) => {
        editingRef.current = null
        returnFocusTo.current = refocus ? actionId : null
        setEditingId(null)
    }

    const handleCapture = (actionId: KeybindActionId, chord: KeybindChord | null) => {
        if (editingRef.current !== actionId) return
        // Stop recording even when the chord is refused, so the next key (often Tab) is never recorded by mistake.
        showError(actionId, chord ? setKeybindChords(actionId, [chord]) : null)
        stopRecording(actionId)
    }

    const handleCancel = (actionId: KeybindActionId, refocus: boolean) => {
        if (editingRef.current !== actionId) return
        setError(null)
        stopRecording(actionId, refocus)
    }

    const handleClear = (actionId: KeybindActionId) => {
        setError(null)
        setKeybindChords(actionId, [])
        editingRef.current = null
        setEditingId(null)
        // The Clear button goes away, so keep focus in this row.
        focusEdit(actionId)
    }

    const handleReset = (actionId: KeybindActionId) => {
        const refusal = resetKeybind(actionId)
        showError(actionId, refusal)
        // Reset is turned off once the row is back to its default, so keep focus in this row.
        if (!refusal) focusEdit(actionId)
    }

    // Moves the shortcut here from the action that has it, which is left without one.
    const handleReassign = (actionId: KeybindActionId, chords: KeybindChord[]) => {
        showError(actionId, reassignKeybind(actionId, chords))
        focusEdit(actionId)
    }

    const handleDismiss = (actionId: KeybindActionId) => {
        setError(null)
        focusEdit(actionId)
    }

    const handleResetAll = () => {
        setError(null)
        resetAllKeybinds()
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">Click Edit to rebind a shortcut. Press Esc or Tab to cancel recording.</p>
                <AlertDialog>
                    <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Reset all</AlertDialogTrigger>
                    <AlertDialogPopup>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Reset all keyboard shortcuts?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Every shortcut goes back to its default, and the ones you changed are lost. This cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogClose render={<Button type="button" variant="outline" />}>Cancel</AlertDialogClose>
                            <AlertDialogClose render={<Button type="button" variant="destructive" />} onClick={handleResetAll}>
                                Reset all
                            </AlertDialogClose>
                        </AlertDialogFooter>
                    </AlertDialogPopup>
                </AlertDialog>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
                {KEYBIND_ACTIONS.map((action) => {
                    const chords = settings.keybinds[action.id] ?? []
                    const isEditing = editingId === action.id
                    const isDefault = chordListsEqual(chords, defaults[action.id] ?? [])
                    const clashes = sharedWith(action.id)
                    // Saved before editor keys were refused, so it still takes the key from the editor.
                    const editorClashes = chords.flatMap((chord) => describeEditorChordClash(chord, isMacPlatform(), action.id) ?? [])
                    // Not a clash: the Markdown action has the keys only while typing in the editor.
                    const takenWhileTyping = editorActionsSharingKeys(settings.keybinds, action.id)
                    const rowError = error?.actionId === action.id ? error : null

                    return (
                        <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{action.label}</p>
                                <p className="text-xs text-muted-foreground">
                                    {action.category}
                                    {isDefault ? null : <span className="text-foreground"> · Changed</span>}
                                </p>
                                {clashes.length > 0 ? (
                                    <p className="text-xs text-warning-foreground">
                                        Same shortcut as {clashes.join(', ')}. Only one of them will run.
                                    </p>
                                ) : null}
                                {editorClashes.map((clash) => (
                                    <p key={clash} className="text-xs text-warning-foreground">
                                        {clash}. Clear or reset this shortcut to give it back.
                                    </p>
                                ))}
                                {takenWhileTyping.map(({ chord, actionId }) => (
                                    <p key={`${formatChord(chord)} ${actionId}`} className="text-xs text-muted-foreground">
                                        While typing in a Markdown file, {formatChord(chord)} runs {getKeybindActionMeta(actionId)?.label} instead.
                                    </p>
                                ))}
                                {rowError ? (
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <p role="alert" className="text-xs text-destructive-foreground">
                                            {rowError.message}
                                        </p>
                                        {rowError.reassign ? (
                                            <>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="outline"
                                                    aria-label={`Reassign ${formatChords(rowError.reassign)} to ${action.label}`}
                                                    onClick={() => handleReassign(action.id, rowError.reassign ?? [])}
                                                >
                                                    Reassign
                                                </Button>
                                                <Button type="button" size="xs" variant="ghost" onClick={() => handleDismiss(action.id)}>
                                                    Cancel
                                                </Button>
                                            </>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                                {isEditing ? (
                                    <KeybindCapture
                                        active
                                        label={action.label}
                                        onCapture={(chord) => handleCapture(action.id, chord)}
                                        onCancel={(refocus) => handleCancel(action.id, refocus)}
                                        onReject={(message) => showError(action.id, { message })}
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
                                            aria-label={`Edit shortcut for ${action.label}`}
                                            onClick={() => startRecording(action.id)}
                                        >
                                            Edit
                                        </Button>
                                        {chords.length > 0 ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                aria-label={`Clear shortcut for ${action.label}`}
                                                onClick={() => handleClear(action.id)}
                                            >
                                                Clear
                                            </Button>
                                        ) : null}
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={`Reset ${action.label} to default`}
                                            disabled={isDefault}
                                            onClick={() => handleReset(action.id)}
                                        >
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
