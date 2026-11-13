'use client'

import { useCallback, useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useCreateNewItem, type NewItemKind } from '@/components/studio/explorer/use-file-tree-actions'
import { useActiveTabId, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import type { KeybindActionId } from '@/lib/settings/types'
import { newItemFolder } from '@/lib/workspace/new-item-folder'

export type NewItemCommandsContext = {
    hasWorkspace: boolean
    /** The folder a new item goes in, worked out when a command runs. */
    targetFolder: () => string | null
    createNewItem: (kind: NewItemKind, folder: string) => Promise<void>
}

const NEW_ITEMS: { kind: NewItemKind; label: string; keywords: string; keybind: KeybindActionId }[] = [
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
            if (folder) void ctx.createNewItem(kind, folder)
        },
    }))
}

/** The path of the explorer row the keyboard is on, or null. Only a shortcut runs with focus still there. */
function focusedRowPath(): string | null {
    const active = document.activeElement
    return active instanceof HTMLElement && active.getAttribute('role') === 'treeitem' ? (active.dataset.path ?? null) : null
}

/** Registers the new item commands. They work whether or not the explorer is on screen. */
export function useNewItemCommands(): void {
    const { workspaceRoot, tree } = useWorkspaceSession()
    const activeTabId = useActiveTabId()
    const createNewItem = useCreateNewItem()

    const targetFolder = useCallback(
        () => (workspaceRoot ? newItemFolder({ root: workspaceRoot, tree, selectedPath: focusedRowPath(), activePath: activeTabId }) : null),
        [workspaceRoot, tree, activeTabId]
    )

    const commands = useMemo(
        () => buildNewItemCommands({ hasWorkspace: Boolean(workspaceRoot), targetFolder, createNewItem }),
        [workspaceRoot, targetFolder, createNewItem]
    )
    useRegisterCommands(commands)
}
