'use client'

import { useCallback, useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { requestRevealActiveFile, setExplorerPanel } from '@/components/studio/explorer/explorer-view'
import { useDocumentTabs, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { closedFoldersAbove, openFolderPaths } from '@/lib/workspace/folder-toggles'

export type ExplorerCommandsContext = {
    hasWorkspace: boolean
    /** The open tab is a file the explorer lists. */
    canRevealActiveFile: boolean
    collapseAllFolders: () => void
    revealActiveFile: () => void
}

const NO_FOLDER = 'No folder open'

/** Showing the open file in the explorer, and closing every folder. */
export function buildExplorerCommands(ctx: ExplorerCommandsContext): AppCommand[] {
    return [
        {
            id: 'reveal-active-file',
            label: 'Reveal Active File in Explorer',
            keywords: 'show locate find current open file explorer files tree sidebar',
            disabled: !ctx.hasWorkspace || !ctx.canRevealActiveFile,
            disabledReason: ctx.hasWorkspace ? 'No file from the folder is open' : NO_FOLDER,
            run: () => ctx.revealActiveFile(),
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

/**
 * Collapse All and Reveal Active File, for the explorer's buttons and the palette. Takes the open tab, so the
 * explorer can pass one that doesn't change with every keystroke.
 */
export function useExplorerTreeActions(activeTabId: string | null): Omit<ExplorerCommandsContext, 'hasWorkspace'> {
    const { tree, folderToggles, setFoldersExpanded } = useWorkspaceSession()
    const { layout, setExplorerOpen } = useStudioLayout()
    const explorerOpen = layout.explorerOpen

    const canRevealActiveFile = activeTabId !== null && closedFoldersAbove(tree, folderToggles, activeTabId) !== null

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
    const { workspaceRoot } = useWorkspaceSession()
    const { activeTabId } = useDocumentTabs()
    const { canRevealActiveFile, collapseAllFolders, revealActiveFile } = useExplorerTreeActions(activeTabId)
    const hasWorkspace = Boolean(workspaceRoot)

    const commands = useMemo(
        () => buildExplorerCommands({ hasWorkspace, canRevealActiveFile, collapseAllFolders, revealActiveFile }),
        [hasWorkspace, canRevealActiveFile, collapseAllFolders, revealActiveFile]
    )
    useRegisterCommands(commands)
}
