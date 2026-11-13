'use client'

import { ChevronsDownUp, LocateFixed } from 'lucide-react'
import { useExplorerTreeActions } from '@/components/studio/explorer/explorer-commands'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'

const NO_FILE_TO_REVEAL = 'No file from the folder is open'

/** The explorer's Reveal Active File and Collapse All buttons; the palette has the same commands. */
export function ExplorerTreeButtons() {
    const { canRevealActiveFile, collapseAllFolders, revealActiveFile } = useExplorerTreeActions()
    // When it can't be used, the tooltip says why instead.
    const revealLabel = canRevealActiveFile ? 'Reveal active file' : NO_FILE_TO_REVEAL

    return (
        <>
            {/* aria-disabled rather than disabled, so it can still be focused or hovered to say why. */}
            <IconTooltip label={revealLabel} description={canRevealActiveFile ? undefined : revealLabel}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reveal active file"
                    aria-disabled={!canRevealActiveFile || undefined}
                    className="aria-disabled:cursor-default aria-disabled:opacity-64 aria-disabled:hover:bg-transparent"
                    onClick={canRevealActiveFile ? revealActiveFile : undefined}
                >
                    <LocateFixed className="size-4" />
                </Button>
            </IconTooltip>
            <IconTooltip label="Collapse all folders">
                <Button variant="ghost" size="icon-sm" aria-label="Collapse all folders" onClick={collapseAllFolders}>
                    <ChevronsDownUp className="size-4" />
                </Button>
            </IconTooltip>
        </>
    )
}
