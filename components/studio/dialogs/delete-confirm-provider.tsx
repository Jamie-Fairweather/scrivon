'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { describeDelete, type DeleteSummary } from '@/lib/workspace/delete-summary'
import { displayPath } from '@/lib/workspace/display-path'
import type { FileNode } from '@/lib/workspace/types'

type DeleteConfirmContextValue = {
    /** Asks before deleting `node`, saying what goes and which open tabs close. Resolves true for Delete. */
    confirmDelete: (node: FileNode) => Promise<boolean>
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
    const coordinator = useWorkspaceCoordinator()
    const { workspaceRoot } = useWorkspaceSession()

    const [open, setOpen] = useState(false)
    const [summary, setSummary] = useState<DeleteSummary | null>(null)

    const finish = useCallback((confirmed: boolean) => {
        pendingRef.current?.(confirmed)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const confirmDelete = useCallback(
        (node: FileNode) => {
            return new Promise<boolean>((resolve) => {
                if (pendingRef.current) {
                    pendingRef.current(false)
                }
                pendingRef.current = resolve
                const isDirectory = node.kind === 'directory'
                setSummary(describeDelete(node, workspaceRoot, coordinator.findTabsToCloseOnDelete.current(node.path, isDirectory)))
                setOpen(true)
            })
        },
        [coordinator, workspaceRoot]
    )

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) finish(false)
            else setOpen(true)
        },
        [finish]
    )

    const value = useMemo(() => ({ confirmDelete }), [confirmDelete])

    return (
        <DeleteConfirmContext.Provider value={value}>
            {children}
            <AlertDialog onOpenChange={handleOpenChange} open={open}>
                <AlertDialogPopup>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{summary?.title}</AlertDialogTitle>
                        {/* Long names with no spaces (snake_case, dotted) break anywhere instead of running past the dialog. */}
                        <AlertDialogDescription className="wrap-anywhere">
                            {/* The path stands out, so it's clear at a glance what is about to go. */}
                            Moves <span className="font-medium text-foreground">{displayPath(summary?.path ?? '')}</span>
                            {summary?.isDirectory ? ' and everything in it' : ''} to the Recycle Bin. {summary?.contents}
                        </AlertDialogDescription>
                        {(summary?.closingTabs || summary?.unsaved) && (
                            <ul className="flex flex-col gap-1 text-sm wrap-anywhere text-muted-foreground">
                                {summary.closingTabs && <li>{summary.closingTabs}</li>}
                                {summary.unsaved && <li className="font-medium text-destructive-foreground">{summary.unsaved}</li>}
                            </ul>
                        )}
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
