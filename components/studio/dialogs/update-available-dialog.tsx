'use client'

import dynamic from 'next/dynamic'
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
    onLater: () => void
    onInstall: () => void
}

export function UpdateAvailableDialog({ update, notesLoading, installing, onLater, onInstall }: UpdateAvailableDialogProps) {
    const showChangelog = Boolean(update.notes?.trim()) || notesLoading

    return (
        <Dialog open onOpenChange={(open) => !open && !installing && onLater()}>
            <DialogPopup className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Update available</DialogTitle>
                    <DialogDescription>Version {update.version} is ready to install.</DialogDescription>
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
                <DialogFooter variant="bare">
                    <Button type="button" variant="outline" disabled={installing} onClick={onLater}>
                        Later
                    </Button>
                    <Button type="button" disabled={installing} onClick={onInstall}>
                        {installing ? 'Installing…' : 'Install and restart'}
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
