'use client'

import { ClipboardCopy, FolderOpen } from 'lucide-react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { MenuItem } from '@/components/ui/menu'
import { copyPath, relativeToWorkspace, revealInFileExplorer } from '@/lib/workspace/path-actions'

/**
 * Reveal in File Explorer, Copy Path and Copy Relative Path, for a file or folder on disk. Used by the
 * explorer's row menu and the tab menu. Reveal and the relative path only work inside the open folder.
 */
export function PathMenuItems({ path }: { path: string }) {
    const { workspaceRoot } = useWorkspaceSession()
    const relative = relativeToWorkspace(path, workspaceRoot)

    return (
        <>
            <MenuItem disabled={relative === null} onClick={() => void revealInFileExplorer(path, workspaceRoot)}>
                <FolderOpen />
                Reveal in File Explorer
            </MenuItem>
            <MenuItem onClick={() => void copyPath(path)}>
                <ClipboardCopy />
                Copy Path
            </MenuItem>
            <MenuItem
                disabled={relative === null}
                onClick={() => {
                    if (relative !== null) void copyPath(relative, 'relative')
                }}
            >
                <ClipboardCopy />
                Copy Relative Path
            </MenuItem>
        </>
    )
}
