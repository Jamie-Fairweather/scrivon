'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    AlertDialog,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** What happened to a file outside Scrivon while it was open. */
export type DiskChange = 'changed' | 'deleted'

/**
 * What to do about it: save the user's version over it (or, for a deleted file, there again), open the
 * version now on disk instead (only for a changed file), or leave both as they are for now.
 */
export type DiskChangeChoice = 'overwrite' | 'reload' | 'keep'

type Question = { fileName: string; change: DiskChange; answer: (choice: DiskChangeChoice) => void }

/** Set while a DiskChangeDialog is mounted to show the questions in. */
let showQuestion: ((question: Question) => void) | null = null

/**
 * Asks before a save replaces a file someone else changed, or puts back a file someone deleted. For a
 * changed file the user can also reload it, which drops their edits. It is asked in the window rather than
 * in a system dialog, which gives the keyboard to its first button: there a key typed as it opened could
 * overwrite. Here Don't Save has the keyboard, and Esc keeps both versions too. Resolves 'keep' when no
 * DiskChangeDialog is mounted to ask with.
 */
export function confirmOverwriteDiskChange(fileName: string, change: DiskChange): Promise<DiskChangeChoice> {
    const show = showQuestion
    if (!show) return Promise.resolve('keep')
    return new Promise((resolve) => show({ fileName, change, answer: resolve }))
}

/** Shows the questions confirmOverwriteDiskChange asks, one at a time. Mounted once, by DocumentSaveProvider. */
export function DiskChangeDialog() {
    const [question, setQuestion] = useState<Omit<Question, 'answer'> | null>(null)
    const [open, setOpen] = useState(false)
    const answerRef = useRef<((choice: DiskChangeChoice) => void) | null>(null)
    const keepRef = useRef<HTMLButtonElement>(null)

    const finish = useCallback((choice: DiskChangeChoice) => {
        const answer = answerRef.current
        answerRef.current = null
        answer?.(choice)
        setOpen(false)
    }, [])

    useEffect(() => {
        const show = ({ answer, ...asked }: Question) => {
            // Only one question at a time: one still open when another comes keeps both versions.
            answerRef.current?.('keep')
            answerRef.current = answer
            setQuestion(asked)
            setOpen(true)
        }
        showQuestion = show
        return () => {
            if (showQuestion === show) showQuestion = null
            answerRef.current?.('keep')
            answerRef.current = null
        }
    }, [])

    const changed = question?.change !== 'deleted'
    const name = <span className="font-medium text-foreground">{question?.fileName}</span>

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                // Esc, or anything else that closes it, keeps both versions.
                if (!next) finish('keep')
            }}
        >
            <AlertDialogPopup initialFocus={keepRef}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{changed ? 'File changed on disk' : 'File deleted'}</AlertDialogTitle>
                    {/* Long names with no spaces break anywhere instead of running past the dialog. */}
                    <AlertDialogDescription className="wrap-anywhere">
                        {changed ? (
                            <>
                                {name} was changed outside Scrivon since you opened it. Overwrite saves your version, and the other changes are lost.
                                Reload opens the other version, and your changes are lost.
                            </>
                        ) : (
                            <>{name} was deleted or moved outside Scrivon. Save your version there again?</>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {/* First, and it has the keyboard, so Enter or Space typed as the question opens loses nothing. */}
                    <Button ref={keepRef} type="button" variant="ghost" onClick={() => finish('keep')}>
                        Don&apos;t Save
                    </Button>
                    {changed && (
                        <Button type="button" variant="outline" onClick={() => finish('reload')}>
                            Reload
                        </Button>
                    )}
                    <Button type="button" variant={changed ? 'destructive' : 'default'} onClick={() => finish('overwrite')}>
                        {changed ? 'Overwrite' : 'Save Again'}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    )
}
