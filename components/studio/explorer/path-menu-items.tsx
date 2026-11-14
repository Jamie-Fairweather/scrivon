'use client'

import { ClipboardCopy, FolderOpen } from 'lucide-react'
import { buildPathCommands } from '@/components/studio/explorer/path-commands'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { MenuItem } from '@/components/ui/menu'

/**
 * Reveal in File Explorer, Copy Path and Copy Relative Path, for a file or folder on disk. Used by the
 * explorer's row menu and the tab menu, with the palette's names. Reveal and the relative path only work
 * inside the open folder. Pass `icons={false}` in a menu whose other items have no icons, so the labels line up.
 */
export function PathMenuItems({ path, icons = true }: { path: string; icons?: boolean }) {
    const { workspaceRoot } = useWorkspaceSession()
    const commands = buildPathCommands(path, workspaceRoot)
    // Says why some items are greyed out.
    const offReason = commands.find((command) => command.disabled)?.disabledReason

    return (
        <>
            {commands.map((command) => {
                const Icon = command.id === 'reveal-in-file-explorer' ? FolderOpen : ClipboardCopy
                return (
                    <MenuItem key={command.id} disabled={command.disabled} onClick={() => void command.run()}>
                        {icons && <Icon />}
                        {command.label}
                    </MenuItem>
                )
            })}
            {offReason && <p className="px-2 py-1 text-xs text-muted-foreground">{offReason}</p>}
        </>
    )
}
