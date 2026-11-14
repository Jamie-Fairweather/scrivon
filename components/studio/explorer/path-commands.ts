'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useActiveTabId, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { copyPath, relativeToWorkspace, revealInFileExplorer } from '@/lib/workspace/path-actions'

/**
 * Reveal in File Explorer, Copy Path and Copy Relative Path for `path`, a file or folder on disk, or
 * null when there is none (an example tab, or no tab). The palette uses them for the open file, and the
 * explorer and tab menus for theirs, so all show the same names. Reveal and the relative path only work
 * inside the open folder.
 */
export function buildPathCommands(path: string | null, workspaceRoot: string | null): AppCommand[] {
    const relative = path === null ? null : relativeToWorkspace(path, workspaceRoot)
    const noFile = workspaceRoot ? 'No file from the folder is open' : 'No folder open'
    const outsideReason = path === null ? noFile : 'Not in the open folder'
    return [
        {
            id: 'reveal-in-file-explorer',
            label: 'Reveal in File Explorer',
            keywords: 'show open locate windows file explorer folder disk',
            disabled: relative === null,
            disabledReason: outsideReason,
            run: () => {
                if (path !== null) void revealInFileExplorer(path, workspaceRoot)
            },
        },
        {
            id: 'copy-path',
            label: 'Copy Path',
            keywords: 'copy full file path location clipboard',
            disabled: path === null,
            disabledReason: noFile,
            run: () => {
                if (path !== null) void copyPath(path)
            },
        },
        {
            id: 'copy-relative-path',
            label: 'Copy Relative Path',
            keywords: 'copy relative file path location clipboard',
            disabled: relative === null,
            disabledReason: outsideReason,
            run: () => {
                if (relative !== null) void copyPath(relative, 'relative')
            },
        },
    ]
}

/** Registers the path commands for the open tab. */
export function usePathCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    // Not useDocumentTabs: that changes with every keystroke. A file tab's id is its path.
    const activeTabId = useActiveTabId()
    // Tabs only show while a folder is open, and an example has no file on disk.
    const activePath = workspaceRoot && activeTabId !== null && !isExampleTabId(activeTabId) ? activeTabId : null

    const commands = useMemo(() => buildPathCommands(activePath, workspaceRoot), [activePath, workspaceRoot])
    useRegisterCommands(commands)
}
