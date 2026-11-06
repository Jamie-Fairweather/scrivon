'use client'

import dynamic from 'next/dynamic'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'

const ReleaseNotesContent = dynamic(() => import('@/components/studio/dialogs/release-notes-content').then((m) => m.ReleaseNotesContent), {
    ssr: false,
})

export type AppUpdateInfo = {
    version: string
    notes: string | null
}

type UpdateAvailableDialogProps = {
    update: AppUpdateInfo
    notesLoading: boolean
    installing: boolean
    /** Some open files could not be saved, so the install was stopped. */
    saveFailed: boolean
    onLater: () => void
    onInstall: () => void
    onInstallAnyway: () => void
}

export function UpdateAvailableDialog({
    update,
    notesLoading,
    installing,
    saveFailed,
    onLater,
    onInstall,
    onInstallAnyway,
}: UpdateAvailableDialogProps) {
    const showChangelog = Boolean(update.notes?.trim()) || notesLoading

    return (
        <Dialog open onOpenChange={(open) => !open && !installing && onLater()}>
            <DialogPopup className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Update available</DialogTitle>
                    <DialogDescription>
                        Version {update.version} is ready to install. Open files are saved first, then the app restarts.
                    </DialogDescription>
                </DialogHeader>
                {showChangelog ? (
                    <DialogPanel className="max-h-56 pt-0">
                        <h3 className="mb-2 text-sm font-medium">What&apos;s new</h3>
                        {notesLoading && !update.notes?.trim() ? (
                            <p className="text-sm text-muted-foreground">Loading release notes…</p>
                        ) : update.notes?.trim() ? (
                            <ReleaseNotesContent notes={update.notes} />
                        ) : null}
                    </DialogPanel>
                ) : null}
                {saveFailed ? (
                    <div className="px-6">
                        <Alert variant="error">
                            <TriangleAlert />
                            <AlertTitle>Some open files couldn&apos;t be saved</AlertTitle>
                            <AlertDescription>If you install now, their unsaved changes will be lost.</AlertDescription>
                        </Alert>
                    </div>
                ) : null}
                <DialogFooter variant="bare">
                    <Button type="button" variant="outline" disabled={installing} onClick={onLater}>
                        {saveFailed ? 'Cancel' : 'Later'}
                    </Button>
                    {saveFailed ? (
                        <Button type="button" variant="destructive" disabled={installing} onClick={onInstallAnyway}>
                            {installing ? 'Installing…' : 'Install anyway'}
                        </Button>
                    ) : (
                        <Button type="button" disabled={installing} onClick={onInstall}>
                            {installing ? 'Installing…' : 'Install and restart'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
