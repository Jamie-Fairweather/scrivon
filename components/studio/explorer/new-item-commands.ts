'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useDiagramStarters } from '@/components/studio/dialogs/diagram-starters-provider'
import { useCreateFromTemplate, useCreateNewItem, type NewItemKind } from '@/components/studio/explorer/use-file-tree-actions'
import { useActiveTabId, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import type { KeybindActionId } from '@/lib/settings/types'
import { newItemFolder } from '@/lib/workspace/new-item-folder'

export type NewItemCommandsContext = {
    hasWorkspace: boolean
    /** The folder a new item goes in, worked out when a command runs. */
    targetFolder: () => string | null
    /** Resolves to false when the name prompt was cancelled. */
    createNewItem: (kind: NewItemKind, folder: string) => Promise<boolean>
    /** Asks for a template, then a name, and makes the file. Resolves to false when either was cancelled. */
    newFromTemplate: (folder: string) => Promise<boolean>
    /** Opens the Diagram Starters window, whose main button makes a new diagram in the folder given. */
    newFromStarter: (folder: string) => void
    /** Opens the explorer if it is hidden. */
    showExplorer: () => void
}

/** The explorer's New menus show these names too. */
export const NEW_ITEMS: { kind: NewItemKind; label: string; keywords: string; keybind: KeybindActionId }[] = [
    { kind: 'new-diagram', label: 'New Diagram…', keywords: 'new create file mermaid mmd', keybind: 'workspace.newDiagram' },
    { kind: 'new-document', label: 'New Document…', keywords: 'new create file markdown md', keybind: 'workspace.newDocument' },
    { kind: 'new-folder', label: 'New Folder…', keywords: 'new create directory', keybind: 'workspace.newFolder' },
]

/** New from Template, which the explorer's New menus show after the items above. It has no keys until the user sets some. */
export const NEW_FROM_TEMPLATE = {
    id: 'new-from-template',
    label: 'New from Template…',
    keywords: 'new create file template meeting notes decision record project brief markdown mermaid',
    keybind: 'workspace.newFromTemplate',
} as const satisfies { id: string; label: string; keywords: string; keybind: KeybindActionId }

/** New Diagram from Starter, which the File menu shows after New Diagram. It has no keys or keybind setting yet. */
export const NEW_DIAGRAM_FROM_STARTER = {
    id: 'new-diagram-from-starter',
    label: 'New Diagram from Starter…',
    keywords: 'new create file mermaid mmd diagram starter gallery flowchart sequence class state entity relationship er xy chart',
} as const

/**
 * New Diagram, New Document, New Folder, New from Template and New Diagram from Starter, for the palette, the File
 * menu and their shortcuts.
 */
export function buildNewItemCommands(ctx: NewItemCommandsContext): AppCommand[] {
    const availability = { disabled: !ctx.hasWorkspace, disabledReason: 'Open a folder first' }
    const plainItems = NEW_ITEMS.map(({ kind, label, keywords, keybind }): AppCommand => ({
        id: kind,
        label,
        keywords,
        keybind,
        ...availability,
        run: () => {
            const folder = ctx.targetFolder()
            if (!folder) return
            void ctx.createNewItem(kind, folder).then((named) => {
                // A new file opens in a tab, but a new folder only shows in the explorer.
                if (named && kind === 'new-folder') ctx.showExplorer()
            })
        },
    }))
    const fromTemplate: AppCommand = {
        ...NEW_FROM_TEMPLATE,
        ...availability,
        run: () => {
            // The folder New Document would use, worked out before the picker takes the keyboard.
            const folder = ctx.targetFolder()
            if (folder) void ctx.newFromTemplate(folder)
        },
    }
    const fromStarter: AppCommand = {
        ...NEW_DIAGRAM_FROM_STARTER,
        ...availability,
        run: () => {
            // Worked out before the window takes the keyboard, as for New from Template.
            const folder = ctx.targetFolder()
            if (folder) ctx.newFromStarter(folder)
        },
    }
    return [...plainItems, fromTemplate, fromStarter]
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
    const newFromTemplate = useCreateFromTemplate()
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

    const { openStarterGallery } = useDiagramStarters()
    const newFromStarter = useCallback((folder: string) => openStarterGallery({ primary: 'new-file', folder }), [openStarterGallery])

    const commands = useMemo(
        () =>
            buildNewItemCommands({
                hasWorkspace: Boolean(workspaceRoot),
                targetFolder,
                createNewItem,
                newFromTemplate,
                newFromStarter,
                showExplorer,
            }),
        [workspaceRoot, targetFolder, createNewItem, newFromTemplate, newFromStarter, showExplorer]
    )
    useRegisterCommands(commands)
}
