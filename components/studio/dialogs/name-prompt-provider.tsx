'use client'

import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { documentExtension } from '@/lib/workspace/file-types'

export type NamePromptOptions = {
    title: string
    /** One line under the title, such as which folder a new item goes in. */
    description?: string
    /** The confirm button's label. Defaults to 'Create'. */
    submitLabel?: string
    defaultValue?: string
    /**
     * The end of the name left unselected when the field opens, such as `.png`, so typing a new name keeps it.
     * Null selects the whole name. Left out, a document extension the name ends with (`.md`) is left unselected.
     */
    extension?: string | null
    placeholder?: string
    /**
     * Says why a name can't be used, or null when it can. It runs on the trimmed name as the user types:
     * the reason shows under the field, and the dialog stays open until the name is fixed or cancelled.
     */
    validate?: (name: string) => string | null
}

type NamePromptContextValue = {
    promptName: (options: NamePromptOptions) => Promise<string | null>
}

const NamePromptContext = createContext<NamePromptContextValue | null>(null)

/**
 * Selects `notes` in `notes.md` (or `screenshot` in `screenshot.png`, given `.png`), so typing a new name keeps the
 * file type. Other text is selected whole. See NamePromptOptions.extension.
 */
function selectNameWithoutExtension(input: HTMLInputElement, given: string | null | undefined) {
    const extension = given === undefined ? documentExtension(input.value) : given
    const end = input.value.length - (extension?.length ?? 0)
    if (extension && end > 0 && input.value.endsWith(extension)) input.setSelectionRange(0, end)
    else input.select()
}

export function useNamePrompt(): NamePromptContextValue {
    const ctx = useContext(NamePromptContext)
    if (!ctx) {
        throw new Error('useNamePrompt must be used within NamePromptProvider')
    }
    return ctx
}

export function NamePromptProvider({ children }: { children: ReactNode }) {
    const inputId = useId()
    const errorId = useId()
    const pendingRef = useRef<((value: string | null) => void) | null>(null)
    // Only the field's first focus after the prompt opens selects the name. Focus comes back to it when the user
    // switches back to the window, and selecting then would let the next key replace what they typed.
    const selectOnFocusRef = useRef(false)

    const [open, setOpen] = useState(false)
    const [request, setRequest] = useState<NamePromptOptions>({ title: '' })
    const [value, setValue] = useState('')

    const { title, description, submitLabel = 'Create', extension, placeholder, validate } = request
    const trimmed = value.trim()
    const error = open && validate ? validate(trimmed) : null
    const canSubmit = trimmed.length > 0 && !error

    const finish = useCallback((result: string | null) => {
        pendingRef.current?.(result)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const promptName = useCallback((options: NamePromptOptions) => {
        return new Promise<string | null>((resolve) => {
            if (pendingRef.current) {
                pendingRef.current(null)
            }
            pendingRef.current = resolve
            selectOnFocusRef.current = true
            setRequest(options)
            setValue(options.defaultValue ?? '')
            setOpen(true)
        })
    }, [])

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) finish(null)
            else setOpen(true)
        },
        [finish]
    )

    const handleSubmit = useCallback(
        (event: React.FormEvent) => {
            event.preventDefault()
            // An unusable name keeps the dialog open with the typed text, so the user can fix it.
            if (!canSubmit) return
            finish(trimmed)
        },
        [canSubmit, finish, trimmed]
    )

    return (
        <NamePromptContext.Provider value={{ promptName }}>
            {children}
            <Dialog onOpenChange={handleOpenChange} open={open}>
                <DialogPopup showCloseButton={false}>
                    <DialogHeader>
                        {/* Titles and descriptions can hold long file names; let those wrap instead of overflowing.
                            The title's lines need room between them once it wraps; the shared title sets them tight for one line. */}
                        <DialogTitle className="leading-snug wrap-anywhere">{title}</DialogTitle>
                        {description && <DialogDescription className="wrap-anywhere">{description}</DialogDescription>}
                    </DialogHeader>
                    <form className="contents" onSubmit={handleSubmit}>
                        <DialogPanel>
                            <Field>
                                <FieldLabel htmlFor={inputId}>Name</FieldLabel>
                                <Input
                                    aria-describedby={error ? errorId : undefined}
                                    aria-invalid={error ? true : undefined}
                                    autoFocus
                                    // A Hebrew or Arabic name reads right to left as it is typed.
                                    dir="auto"
                                    id={inputId}
                                    nativeInput
                                    onChange={(e) => setValue(e.target.value)}
                                    onFocus={(e) => {
                                        if (!selectOnFocusRef.current) return
                                        selectOnFocusRef.current = false
                                        selectNameWithoutExtension(e.target, extension)
                                    }}
                                    placeholder={placeholder}
                                    value={value}
                                />
                                {/* Errors quote names too ('A file named "…" already exists here.'), so they wrap the same way. */}
                                <p aria-live="polite" className="min-h-4 w-full text-xs wrap-anywhere text-destructive-foreground" id={errorId}>
                                    {error}
                                </p>
                            </Field>
                        </DialogPanel>
                        <DialogFooter>
                            <DialogClose render={<Button type="button" variant="ghost" />} onClick={() => finish(null)}>
                                Cancel
                            </DialogClose>
                            <Button disabled={!canSubmit} type="submit">
                                {submitLabel}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogPopup>
            </Dialog>
        </NamePromptContext.Provider>
    )
}
