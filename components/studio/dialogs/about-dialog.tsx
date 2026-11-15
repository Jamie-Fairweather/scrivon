'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { APP_AFFILIATION, APP_COPYRIGHT, APP_NAME, APP_REPO_URL, APP_TAGLINE } from '@/lib/app-branding'
import { APP_VERSION } from '@/lib/legal/app-version'
import { inlineLinkClassName } from '@/lib/ui/link-classes'
import { isPrereleaseVersion } from '@/lib/updater/version'

type AboutDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onOpenLicenses: () => void
    /** The same as Help > Copy Diagnostic Info. */
    onCopyDiagnosticInfo: () => void
}

export function AboutDialog({ open, onOpenChange, onOpenLicenses, onCopyDiagnosticInfo }: AboutDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPopup className="max-w-md">
                <DialogHeader>
                    <DialogTitle>About {APP_NAME}</DialogTitle>
                    <DialogDescription>
                        {APP_TAGLINE}
                        <span className="mt-1 flex items-center gap-2 text-muted-foreground">
                            Version {APP_VERSION}
                            {isPrereleaseVersion(APP_VERSION) ? (
                                <Badge variant="warning" size="sm">
                                    Pre-release
                                </Badge>
                            ) : null}
                        </span>
                    </DialogDescription>
                </DialogHeader>
                <DialogPanel className="space-y-3 pt-0">
                    <p className="text-sm text-muted-foreground">
                        Edit Mermaid diagrams and Markdown documents in a folder workspace with live preview. Save diagrams as SVG or PNG, and
                        documents as PDF, Word or HTML. Diagram rendering uses{' '}
                        <a
                            href="https://github.com/lukilabs/beautiful-mermaid"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={inlineLinkClassName}
                        >
                            beautiful-mermaid
                        </a>
                        .
                    </p>
                    <p className="text-sm text-muted-foreground">{APP_AFFILIATION}</p>
                    <p className="text-sm">
                        <a href={APP_REPO_URL} target="_blank" rel="noopener noreferrer" className={inlineLinkClassName}>
                            Source code on GitHub
                        </a>
                    </p>
                    <p className="text-xs text-muted-foreground">{APP_COPYRIGHT}</p>
                </DialogPanel>
                <DialogFooter variant="bare">
                    <Button type="button" variant="ghost" onClick={onCopyDiagnosticInfo}>
                        Copy diagnostic info
                    </Button>
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
