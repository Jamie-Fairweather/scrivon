'use client'

import { useCallback, useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { getBaseName, samePath } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'

export type WorkspaceCommandsContext = {
    isDesktop: boolean
    workspaceRoot: string | null
    recentWorkspaces: string[]
    pickAndOpenWorkspace: () => Promise<void>
    openWorkspace: (path: string) => Promise<void>
    closeWorkspace: () => Promise<void>
    refreshExplorer: () => Promise<void>
}

/** Opening, closing and refreshing the folder, and the recent folders. */
export function buildWorkspaceCommands(ctx: WorkspaceCommandsContext): AppCommand[] {
    const hasWorkspace = Boolean(ctx.workspaceRoot)
    const commands: AppCommand[] = [
        {
            id: 'open-folder',
            label: 'Open Folder…',
            keywords: 'open folder workspace',
            disabled: !ctx.isDesktop,
            disabledReason: 'Desktop only',
            run: () => void ctx.pickAndOpenWorkspace(),
        },
        {
            id: 'close-folder',
            label: 'Close Folder',
            keywords: 'close folder workspace',
            disabled: !hasWorkspace,
            disabledReason: 'No folder open',
            run: () => void ctx.closeWorkspace(),
        },
        {
            id: 'refresh-explorer',
            label: 'Refresh Explorer',
            keywords: 'refresh reload explorer files',
            disabled: !hasWorkspace,
            disabledReason: 'Open a folder first',
            run: () => void ctx.refreshExplorer(),
        },
    ]

    for (const path of ctx.recentWorkspaces) {
        const current = ctx.workspaceRoot !== null && samePath(path, ctx.workspaceRoot)
        commands.push({
            id: `recent-workspace:${path}`,
            label: `Open Recent Folder: ${getBaseName(path)}`,
            keywords: `recent workspace ${getBaseName(path)} ${path}`,
            // Two recent folders can share a name, so show where each one is (the note first, so it isn't cut off).
            detail: current ? `Current folder · ${displayPath(path)}` : displayPath(path),
            disabled: !ctx.isDesktop,
            disabledReason: 'Desktop only',
            run: () => void ctx.openWorkspace(path),
        })
    }

    return commands
}

/**
 * Reads the folder again, for every Refresh (the explorer's button and menu, the palette). The open files with no
 * edits are read again too: where the file watcher misses changes (a network share, say), the new file list would
 * otherwise sit beside old text.
 */
export function useRefreshExplorer(): () => Promise<void> {
    const { refreshTree } = useWorkspaceSession()
    const coordinator = useWorkspaceCoordinator()
    return useCallback(async () => {
        const reloadTabs = coordinator.reloadChangedTabs
            .current()
            .catch((err: unknown) => console.warn("Couldn't check the open files for changes", err))
        await Promise.all([refreshTree(), reloadTabs])
    }, [refreshTree, coordinator])
}

export function useWorkspaceCommands(): void {
    const { isDesktop, workspaceRoot, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } = useWorkspaceSession()
    const refreshExplorer = useRefreshExplorer()

    const commands = useMemo(
        () =>
            buildWorkspaceCommands({
                isDesktop,
                workspaceRoot,
                recentWorkspaces,
                pickAndOpenWorkspace,
                openWorkspace,
                closeWorkspace,
                refreshExplorer,
            }),
        [isDesktop, workspaceRoot, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace, refreshExplorer]
    )
    useRegisterCommands(commands)
}
