'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'

export type AppUpdateInfo = {
    version: string
    notes: string | null
    channel: string
}

type UpdateAvailableDialogProps = {
    update: AppUpdateInfo
    installing: boolean
    onLater: () => void
    onInstall: () => void
}

export function UpdateAvailableDialog({ update, installing, onLater, onInstall }: UpdateAvailableDialogProps) {
    const channelLabel = update.channel === 'rc' ? 'pre-release' : 'stable release'

    return (
        <Dialog open onOpenChange={(open) => !open && !installing && onLater()}>
            <DialogPopup className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Update available</DialogTitle>
                    <DialogDescription>
                        Version {update.version} ({channelLabel}) is ready to install.
                    </DialogDescription>
                </DialogHeader>
                {update.notes ? (
                    <DialogPanel className="pt-0">
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{update.notes}</p>
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
