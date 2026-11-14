'use client'

import dynamic from 'next/dynamic'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'

const ReleaseNotesContent = dynamic(() => import('@/components/studio/dialogs/release-notes-content').then((m) => m.ReleaseNotesContent), {
    ssr: false,
})

export type AppUpdateInfo = {
    version: string
    notes: string | null
}

/**
 * Where Install is: not started, saving the open files first (any question about them comes up in its own
 * window, as when closing the app), downloading the update, or installing it.
 */
export type InstallPhase = 'idle' | 'saving' | 'downloading' | 'installing'

/** Bytes downloaded so far, and the download's size when the server says it. */
export type DownloadProgress = { downloaded: number; total: number | null }

type UpdateAvailableDialogProps = {
    update: AppUpdateInfo
    notesLoading: boolean
    phase: InstallPhase
    /** Null until the first bytes arrive. */
    download: DownloadProgress | null
    /** Why the last Install failed, if it did. */
    error?: string | null
    onLater: () => void
    onInstall: () => void
}

const INSTALL_LABEL: Record<InstallPhase, string> = {
    idle: 'Install and restart',
    saving: 'Saving files…',
    downloading: 'Downloading…',
    installing: 'Installing…',
}

/**
 * What a screen reader says as Install moves on: each step once. The download's byte count changes many times
 * a second, so it isn't announced; the progress bar gives it when asked.
 */
const PHASE_ANNOUNCEMENT: Record<InstallPhase, string> = {
    idle: '',
    saving: 'Saving open files',
    downloading: 'Downloading the update',
    installing: 'Installing the update',
}

function megabytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(1)
}

/** What the dialog says while Install runs, with the download's progress bar (a spinner when its size is unknown). */
function InstallStatus({ phase, download }: { phase: InstallPhase; download: DownloadProgress | null }) {
    if (phase === 'idle') return null
    if (phase === 'downloading' && download?.total) {
        const percent = Math.min(100, (download.downloaded / download.total) * 100)
        return (
            <div className="space-y-2 px-6">
                <p className="text-sm text-muted-foreground">
                    Downloading {megabytes(download.downloaded)} / {megabytes(download.total)} MB
                </p>
                <Progress value={percent} aria-label="Download progress" />
            </div>
        )
    }
    const text =
        phase === 'saving'
            ? 'Saving open files…'
            : phase === 'installing'
              ? 'Installing…'
              : download
                ? `Downloading ${megabytes(download.downloaded)} MB…`
                : 'Downloading…'
    return (
        <p className="flex items-center gap-2 px-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {text}
        </p>
    )
}

export function UpdateAvailableDialog({ update, notesLoading, phase, download, error, onLater, onInstall }: UpdateAvailableDialogProps) {
    const showChangelog = Boolean(update.notes?.trim()) || notesLoading
    const busy = phase !== 'idle'

    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onLater()}>
            {/* No close button while installing: closing then does nothing, so it isn't offered. */}
            <DialogPopup className="max-w-md" showCloseButton={!busy}>
                <DialogHeader>
                    <DialogTitle>Update available</DialogTitle>
                    <DialogDescription>Version {update.version} is available. Open files are saved first, then the app restarts.</DialogDescription>
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
                <InstallStatus phase={phase} download={download} />
                {error && phase === 'idle' ? (
                    <div className="px-6">
                        <Alert variant="error">
                            <AlertTitle>Couldn&apos;t install the update</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    </div>
                ) : null}
                {/* There from the start, so the first step is announced too. */}
                <p className="sr-only" aria-live="polite" aria-atomic="true">
                    {PHASE_ANNOUNCEMENT[phase]}
                </p>
                <DialogFooter variant="bare">
                    <Button type="button" variant="outline" disabled={busy} onClick={onLater}>
                        Later
                    </Button>
                    <Button type="button" loading={busy} onClick={onInstall}>
                        {error && phase === 'idle' ? 'Try again' : INSTALL_LABEL[phase]}
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
