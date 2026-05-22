'use client'

import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type NamePromptContextValue = {
    promptName: (title: string, defaultValue?: string) => Promise<string | null>
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
    const pendingRef = useRef<((value: string | null) => void) | null>(null)

    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [value, setValue] = useState('')

    const finish = useCallback((result: string | null) => {
        pendingRef.current?.(result)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const promptName = useCallback((dialogTitle: string, defaultValue = '') => {
        return new Promise<string | null>((resolve) => {
            if (pendingRef.current) {
                pendingRef.current(null)
            }
            pendingRef.current = resolve
            setTitle(dialogTitle)
            setValue(defaultValue)
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
            const trimmed = value.trim()
            finish(trimmed.length > 0 ? trimmed : null)
        },
        [finish, value]
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
                                    autoFocus
                                    id={inputId}
                                    nativeInput
                                    onChange={(e) => setValue(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    placeholder="diagram.mmd"
                                    value={value}
                                />
                            </Field>
                        </DialogPanel>
                        <DialogFooter>
                            <DialogClose render={<Button type="button" variant="ghost" />} onClick={() => finish(null)}>
                                Cancel
                            </DialogClose>
                            <Button type="submit">{dialogCopy.submitLabel}</Button>
                        </DialogFooter>
                    </form>
                </DialogPopup>
            </Dialog>
        </NamePromptContext.Provider>
    )
}
