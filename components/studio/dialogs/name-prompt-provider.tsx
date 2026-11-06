'use client'

import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export type NamePromptOptions = {
    title: string
    defaultValue?: string
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

    const [open, setOpen] = useState(false)
    const [request, setRequest] = useState<NamePromptOptions>({ title: '' })
    const [value, setValue] = useState('')

    const { title, placeholder, validate } = request
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
            setRequest(options)
            setValue(options.defaultValue ?? '')
            setOpen(true)
        })
    }, [])

    const dialogCopy = useMemo(() => {
        const lower = title.toLowerCase()
        if (lower.includes('rename')) {
            return { description: 'Choose a new name for this item.', submitLabel: 'Rename' }
        }
        if (lower.includes('folder')) {
            return { description: 'Enter a folder name.', submitLabel: 'Create' }
        }
        return { description: 'Enter a file name.', submitLabel: 'Create' }
    }, [title])

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
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{dialogCopy.description}</DialogDescription>
                    </DialogHeader>
                    <form className="contents" onSubmit={handleSubmit}>
                        <DialogPanel>
                            <Field>
                                <FieldLabel htmlFor={inputId}>Name</FieldLabel>
                                <Input
                                    aria-describedby={error ? errorId : undefined}
                                    aria-invalid={error ? true : undefined}
                                    autoFocus
                                    id={inputId}
                                    nativeInput
                                    onChange={(e) => setValue(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    placeholder={placeholder}
                                    value={value}
                                />
                                <p aria-live="polite" className="min-h-4 text-xs text-destructive-foreground" id={errorId}>
                                    {error}
                                </p>
                            </Field>
                        </DialogPanel>
                        <DialogFooter>
                            <DialogClose render={<Button type="button" variant="ghost" />} onClick={() => finish(null)}>
                                Cancel
                            </DialogClose>
                            <Button disabled={!canSubmit} type="submit">
                                {dialogCopy.submitLabel}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogPopup>
            </Dialog>
        </NamePromptContext.Provider>
    )
}
