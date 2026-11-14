'use client'

import { useCallback, useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useMoveTo } from '@/components/studio/dialogs/move-to-provider'
import { requestRevealActiveFile, setExplorerPanel } from '@/components/studio/explorer/explorer-view'
import { useActiveTabId, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { getBaseName } from '@/lib/tauri/fs'
import { closedFoldersAbove, openFolderPaths } from '@/lib/workspace/folder-toggles'

export type ExplorerCommandsContext = {
    hasWorkspace: boolean
    /** The open tab is a file the explorer lists. */
    canRevealActiveFile: boolean
    collapseAllFolders: () => void
    revealActiveFile: () => void
    /** Asks which folder to move the open file to, and moves it there. */
    moveActiveFile: () => void
}

const NO_FOLDER = 'No folder open'

/** Showing the open file in the explorer, moving it, and closing every folder. */
export function buildExplorerCommands(ctx: ExplorerCommandsContext): AppCommand[] {
    return [
        {
            id: 'reveal-active-file',
            label: 'Reveal Active File in Sidebar',
            keywords: 'show locate find current open file explorer files tree sidebar',
            disabled: !ctx.hasWorkspace || !ctx.canRevealActiveFile,
            disabledReason: ctx.hasWorkspace ? 'No file from the folder is open' : NO_FOLDER,
            run: () => ctx.revealActiveFile(),
        },
        {
            id: 'move-active-file',
            label: 'Move Active File to…',
            keywords: 'move current open file folder explorer files tree',
            disabled: !ctx.hasWorkspace || !ctx.canRevealActiveFile,
            disabledReason: ctx.hasWorkspace ? 'No file from the folder is open' : NO_FOLDER,
            run: () => ctx.moveActiveFile(),
        },
        {
            id: 'collapse-all-folders',
            label: 'Collapse All Folders',
            keywords: 'collapse close fold folders explorer files tree sidebar',
            disabled: !ctx.hasWorkspace,
            disabledReason: NO_FOLDER,
            run: () => ctx.collapseAllFolders(),
        },
    ]
}

/** Collapse All and Reveal Active File, for the explorer's buttons and the palette. */
export function useExplorerTreeActions(): Omit<ExplorerCommandsContext, 'hasWorkspace' | 'moveActiveFile'> {
    const { tree, folderToggles, setFoldersExpanded } = useWorkspaceSession()
    const { layout, setExplorerOpen } = useStudioLayout()
    const explorerOpen = layout.explorerOpen
    // Not useDocumentTabs: that changes with every keystroke.
    const activeTabId = useActiveTabId()

    // Memoized: the palette's commands draw again on every keystroke, and this walks the folders above the file.
    const canRevealActiveFile = useMemo(
        () => activeTabId !== null && closedFoldersAbove(tree, folderToggles, activeTabId) !== null,
        [tree, folderToggles, activeTabId]
    )

    const collapseAllFolders = useCallback(
        () => setFoldersExpanded(openFolderPaths(tree, folderToggles), false),
        [tree, folderToggles, setFoldersExpanded]
    )

    // From the palette the explorer may be hidden, or showing the examples.
    const revealActiveFile = useCallback(() => {
        if (!explorerOpen) setExplorerOpen(true)
        setExplorerPanel('files')
        requestRevealActiveFile()
    }, [explorerOpen, setExplorerOpen])

    return { canRevealActiveFile, collapseAllFolders, revealActiveFile }
}

export function useExplorerCommands(): void {
    const { workspaceRoot, moveEntry } = useWorkspaceSession()
    const { canRevealActiveFile, collapseAllFolders, revealActiveFile } = useExplorerTreeActions()
    const { chooseFolder } = useMoveTo()
    const activeTabId = useActiveTabId()
    const hasWorkspace = Boolean(workspaceRoot)

    const moveActiveFile = useCallback(async () => {
        if (!activeTabId) return
        const folder = await chooseFolder({ kind: 'file', name: getBaseName(activeTabId), path: activeTabId })
        if (folder) await moveEntry(activeTabId, false, folder)
    }, [activeTabId, chooseFolder, moveEntry])

    const commands = useMemo(
        () =>
            buildExplorerCommands({
                hasWorkspace,
                canRevealActiveFile,
                collapseAllFolders,
                revealActiveFile,
                moveActiveFile: () => void moveActiveFile(),
            }),
        [hasWorkspace, canRevealActiveFile, collapseAllFolders, revealActiveFile, moveActiveFile]
    )
    useRegisterCommands(commands)
}
