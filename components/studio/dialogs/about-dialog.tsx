'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { APP_AFFILIATION, APP_NAME, APP_TAGLINE } from '@/lib/app-branding'
import { APP_VERSION } from '@/lib/legal/third-party-licenses'

type AboutDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onOpenLicenses: () => void
}

export function AboutDialog({ open, onOpenChange, onOpenLicenses }: AboutDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPopup className="max-w-md">
                <DialogHeader>
                    <DialogTitle>About {APP_NAME}</DialogTitle>
                    <DialogDescription>
                        {APP_TAGLINE}
                        <span className="mt-1 block text-muted-foreground/80">Version {APP_VERSION}</span>
                    </DialogDescription>
                </DialogHeader>
                <DialogPanel className="space-y-3 pt-0">
                    <p className="text-sm text-muted-foreground">{APP_AFFILIATION}</p>
                    <p className="text-sm text-muted-foreground">
                        Edit Mermaid diagrams in a folder workspace with live preview. Diagram rendering uses{' '}
                        <a
                            href="https://github.com/lukilabs/beautiful-mermaid"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground underline-offset-4 hover:underline"
                        >
                            beautiful-mermaid
                        </a>
                        .
                    </p>
                </DialogPanel>
                <DialogFooter variant="bare">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            onOpenChange(false)
                            onOpenLicenses()
                        }}
                    >
                        Licences
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
