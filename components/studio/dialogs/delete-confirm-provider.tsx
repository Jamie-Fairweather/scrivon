'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

type DeleteConfirmContextValue = {
    confirmDelete: (itemName: string, isDirectory?: boolean) => Promise<boolean>
}

const DeleteConfirmContext = createContext<DeleteConfirmContextValue | null>(null)

export function useDeleteConfirm(): DeleteConfirmContextValue {
    const ctx = useContext(DeleteConfirmContext)
    if (!ctx) {
        throw new Error('useDeleteConfirm must be used within DeleteConfirmProvider')
    }
    return ctx
}

export function DeleteConfirmProvider({ children }: { children: ReactNode }) {
    const pendingRef = useRef<((confirmed: boolean) => void) | null>(null)

    const [open, setOpen] = useState(false)
    const [itemName, setItemName] = useState('')
    const [isDirectory, setIsDirectory] = useState(false)

    const finish = useCallback((confirmed: boolean) => {
        pendingRef.current?.(confirmed)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const confirmDelete = useCallback((name: string, directory = false) => {
        return new Promise<boolean>((resolve) => {
            if (pendingRef.current) {
                pendingRef.current(false)
            }
            pendingRef.current = resolve
            setItemName(name)
            setIsDirectory(directory)
            setOpen(true)
        })
    }, [])

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) finish(false)
            else setOpen(true)
        },
        [finish]
    )

    const description = isDirectory
        ? `Delete folder "${itemName}" and its contents? This cannot be undone.`
        : `Delete "${itemName}"? This cannot be undone.`

    return (
        <DeleteConfirmContext.Provider value={{ confirmDelete }}>
            {children}
            <AlertDialog onOpenChange={handleOpenChange} open={open}>
                <AlertDialogPopup>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {isDirectory ? 'folder' : 'file'}?</AlertDialogTitle>
                        <AlertDialogDescription>{description}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogClose render={<Button type="button" variant="ghost" />} onClick={() => finish(false)}>
                            Cancel
                        </AlertDialogClose>
                        <AlertDialogClose render={<Button type="button" variant="destructive" />} onClick={() => finish(true)}>
                            Delete
                        </AlertDialogClose>
                    </AlertDialogFooter>
                </AlertDialogPopup>
            </AlertDialog>
        </DeleteConfirmContext.Provider>
    )
}
