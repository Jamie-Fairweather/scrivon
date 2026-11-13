'use client'

import { ClipboardCopy, FolderOpen } from 'lucide-react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { MenuItem } from '@/components/ui/menu'
import { copyPath, relativeToWorkspace, revealInFileExplorer } from '@/lib/workspace/path-actions'

/**
 * Reveal in File Explorer, Copy Path and Copy Relative Path, for a file or folder on disk. Used by the
 * explorer's row menu and the tab menu. Reveal and the relative path only work inside the open folder.
 * Pass `icons={false}` in a menu whose other items have no icons, so the labels line up.
 */
export function PathMenuItems({ path, icons = true }: { path: string; icons?: boolean }) {
    const { workspaceRoot } = useWorkspaceSession()
    const relative = relativeToWorkspace(path, workspaceRoot)

    return (
        <>
            <MenuItem disabled={relative === null} onClick={() => void revealInFileExplorer(path, workspaceRoot)}>
                {icons && <FolderOpen />}
                Reveal in File Explorer
            </MenuItem>
            <MenuItem onClick={() => void copyPath(path)}>
                {icons && <ClipboardCopy />}
                Copy Path
            </MenuItem>
            <MenuItem
                disabled={relative === null}
                onClick={() => {
                    if (relative !== null) void copyPath(relative, 'relative')
                }}
            >
                {icons && <ClipboardCopy />}
                Copy Relative Path
            </MenuItem>
            {/* Says why the two items above are greyed out. */}
            {relative === null && <p className="px-2 py-1 text-xs text-muted-foreground">Not in the open folder</p>}
        </>
    )
}
