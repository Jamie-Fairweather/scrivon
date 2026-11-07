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

/**
 * Where Install is: not started, saving the open files first (any question about them comes up in its own
 * window, as when closing the app), or installing.
 */
export type InstallPhase = 'idle' | 'saving' | 'installing'

type UpdateAvailableDialogProps = {
    update: AppUpdateInfo
    notesLoading: boolean
    phase: InstallPhase
    onLater: () => void
    onInstall: () => void
}

const INSTALL_LABEL: Record<InstallPhase, string> = {
    idle: 'Install and restart',
    saving: 'Saving files…',
    installing: 'Installing…',
}

export function UpdateAvailableDialog({ update, notesLoading, phase, onLater, onInstall }: UpdateAvailableDialogProps) {
    const showChangelog = Boolean(update.notes?.trim()) || notesLoading
    const busy = phase !== 'idle'

    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onLater()}>
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
                <DialogFooter variant="bare">
                    <Button type="button" variant="outline" disabled={busy} onClick={onLater}>
                        Later
                    </Button>
                    <Button type="button" disabled={busy} onClick={onInstall}>
                        {INSTALL_LABEL[phase]}
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
