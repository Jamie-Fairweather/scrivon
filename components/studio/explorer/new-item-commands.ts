'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useCreateNewItem, type NewItemKind } from '@/components/studio/explorer/use-file-tree-actions'
import { useActiveTabId, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import type { KeybindActionId } from '@/lib/settings/types'
import { newItemFolder } from '@/lib/workspace/new-item-folder'

export type NewItemCommandsContext = {
    hasWorkspace: boolean
    /** The folder a new item goes in, worked out when a command runs. */
    targetFolder: () => string | null
    /** Resolves to false when the name prompt was cancelled. */
    createNewItem: (kind: NewItemKind, folder: string) => Promise<boolean>
    /** Opens the explorer if it is hidden. */
    showExplorer: () => void
}

/** The explorer's New menus show these names too. */
export const NEW_ITEMS: { kind: NewItemKind; label: string; keywords: string; keybind: KeybindActionId }[] = [
    { kind: 'new-diagram', label: 'New Diagram…', keywords: 'new create file mermaid mmd', keybind: 'workspace.newDiagram' },
    { kind: 'new-document', label: 'New Document…', keywords: 'new create file markdown md', keybind: 'workspace.newDocument' },
    { kind: 'new-folder', label: 'New Folder…', keywords: 'new create directory', keybind: 'workspace.newFolder' },
]

/** New Diagram, New Document and New Folder, for the palette, the File menu and their shortcuts. */
export function buildNewItemCommands(ctx: NewItemCommandsContext): AppCommand[] {
    return NEW_ITEMS.map(({ kind, label, keywords, keybind }) => ({
        id: kind,
        label,
        keywords,
        keybind,
        disabled: !ctx.hasWorkspace,
        disabledReason: 'Open a folder first',
        run: () => {
            const folder = ctx.targetFolder()
            if (!folder) return
            void ctx.createNewItem(kind, folder).then((named) => {
                // A new file opens in a tab, but a new folder only shows in the explorer.
                if (named && kind === 'new-folder') ctx.showExplorer()
            })
        },
    }))
}

/** Where focus goes on the way to a command: the menu bar, a menu, or the palette (a dialog). */
const COMMAND_UI = '[role="menubar"], [role="menu"], [role="dialog"]'

/** The path of `el` when it is an explorer row still on the page, else null. */
function rowPath(el: Element | null): string | null {
    return el instanceof HTMLElement && el.isConnected && el.getAttribute('role') === 'treeitem' ? (el.dataset.path ?? null) : null
}

/**
 * The path of the explorer row the keyboard is on, or was on before the menu bar or the palette took it, else
 * null. Focus going anywhere else (the editor, a tab) means the user has moved on from the row.
 */
function useLastFocusedRow(): () => string | null {
    const lastRowRef = useRef<Element | null>(null)

    useEffect(() => {
        const onFocusIn = (e: FocusEvent) => {
            const target = e.target
            if (!(target instanceof Element)) return
            if (target.getAttribute('role') === 'treeitem') lastRowRef.current = target
            else if (!target.closest(COMMAND_UI)) lastRowRef.current = null
        }
        document.addEventListener('focusin', onFocusIn)
        return () => document.removeEventListener('focusin', onFocusIn)
    }, [])

    return useCallback(() => rowPath(document.activeElement) ?? rowPath(lastRowRef.current), [])
}

/** Registers the new item commands. They work whether or not the explorer is on screen. */
export function useNewItemCommands(): void {
    const { workspaceRoot, tree } = useWorkspaceSession()
    const activeTabId = useActiveTabId()
    const createNewItem = useCreateNewItem()
    const { layout, setExplorerOpen } = useStudioLayout()
    const lastFocusedRow = useLastFocusedRow()

    const targetFolder = useCallback(
        () => (workspaceRoot ? newItemFolder({ root: workspaceRoot, tree, selectedPath: lastFocusedRow(), activePath: activeTabId }) : null),
        [workspaceRoot, tree, lastFocusedRow, activeTabId]
    )

    const explorerOpen = layout.explorerOpen
    const showExplorer = useCallback(() => {
        if (!explorerOpen) setExplorerOpen(true)
    }, [explorerOpen, setExplorerOpen])

    const commands = useMemo(
        () => buildNewItemCommands({ hasWorkspace: Boolean(workspaceRoot), targetFolder, createNewItem, showExplorer }),
        [workspaceRoot, targetFolder, createNewItem, showExplorer]
    )
    useRegisterCommands(commands)
}
