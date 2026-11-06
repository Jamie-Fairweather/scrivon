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

/** Why an install stopped to ask the user: edited files with autosave off, or files that failed to save. */
export type InstallBlocker = { reason: 'unsaved'; fileNames: string[] } | { reason: 'save-failed' }

type UpdateAvailableDialogProps = {
    update: AppUpdateInfo
    notesLoading: boolean
    installing: boolean
    /** Set when the install stopped to ask what to do with open files. */
    blocker: InstallBlocker | null
    onLater: () => void
    onInstall: () => void
    onSaveAndInstall: () => void
    onInstallWithoutSaving: () => void
}

function formatFileNames(names: string[]): string {
    if (names.length <= 3) return names.join(', ')
    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

export function UpdateAvailableDialog({
    update,
    notesLoading,
    installing,
    blocker,
    onLater,
    onInstall,
    onSaveAndInstall,
    onInstallWithoutSaving,
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
                {blocker?.reason === 'unsaved' ? (
                    <div className="px-6">
                        <Alert variant="warning">
                            <TriangleAlert />
                            <AlertTitle>Save changes before installing?</AlertTitle>
                            <AlertDescription>
                                Autosave is off and these files have unsaved changes: {formatFileNames(blocker.fileNames)}.
                            </AlertDescription>
                        </Alert>
                    </div>
                ) : null}
                {blocker?.reason === 'save-failed' ? (
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
                        {blocker ? 'Cancel' : 'Later'}
                    </Button>
                    {blocker?.reason === 'unsaved' ? (
                        <>
                            <Button type="button" variant="destructive-outline" disabled={installing} onClick={onInstallWithoutSaving}>
                                Don&apos;t save
                            </Button>
                            <Button type="button" disabled={installing} onClick={onSaveAndInstall}>
                                {installing ? 'Installing…' : 'Save and install'}
                            </Button>
                        </>
                    ) : blocker?.reason === 'save-failed' ? (
                        <Button type="button" variant="destructive" disabled={installing} onClick={onInstallWithoutSaving}>
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
