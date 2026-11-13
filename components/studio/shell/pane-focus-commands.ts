'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { cyclePaneFocusSoon, focusPaneSoon, type PaneId } from '@/components/studio/shell/pane-focus'
import { useDocumentTabs, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export type PaneFocusCommandsContext = {
    hasWorkspace: boolean
    hasOpenFile: boolean
    explorerOpen: boolean
    editorOpen: boolean
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    focusPane: (id: PaneId) => void
    cyclePaneFocus: (direction: 1 | -1) => void
}

const NO_FOLDER = 'No folder open'

/** Keyboard moves between the explorer, outline, editor and preview. */
export function buildPaneFocusCommands(ctx: PaneFocusCommandsContext): AppCommand[] {
    const off = !ctx.hasWorkspace
    const keywords = 'keyboard move pane panel'
    return [
        {
            id: 'focus-explorer',
            label: 'Focus Explorer',
            keywords: `${keywords} sidebar files`,
            keybind: 'view.focusExplorer',
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => {
                if (!ctx.explorerOpen) ctx.setExplorerOpen(true)
                ctx.focusPane('explorer')
            },
        },
        {
            id: 'focus-editor',
            label: 'Focus Editor',
            keywords,
            keybind: 'view.focusEditor',
            disabled: off || !ctx.hasOpenFile,
            disabledReason: off ? NO_FOLDER : 'No file open',
            run: () => {
                if (!ctx.editorOpen) ctx.setEditorOpen(true)
                ctx.focusPane('editor')
            },
        },
        {
            id: 'focus-preview',
            label: 'Focus Preview',
            keywords: `${keywords} diagram`,
            keybind: 'view.focusPreview',
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.focusPane('preview'),
        },
        {
            id: 'focus-next-pane',
            label: 'Focus Next Pane',
            keywords,
            keybind: 'view.focusNextPane',
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.cyclePaneFocus(1),
        },
        {
            id: 'focus-previous-pane',
            label: 'Focus Previous Pane',
            keywords,
            keybind: 'view.focusPreviousPane',
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.cyclePaneFocus(-1),
        },
    ]
}

export function usePaneFocusCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { activeTabId } = useDocumentTabs()
    const { layout, setExplorerOpen, setEditorOpen } = useStudioLayout()
    const hasWorkspace = Boolean(workspaceRoot)
    const hasOpenFile = activeTabId !== null

    const commands = useMemo(
        () =>
            buildPaneFocusCommands({
                hasWorkspace,
                hasOpenFile,
                explorerOpen: layout.explorerOpen,
                editorOpen: layout.editorOpen,
                setExplorerOpen,
                setEditorOpen,
                focusPane: focusPaneSoon,
                cyclePaneFocus: cyclePaneFocusSoon,
            }),
        [hasWorkspace, hasOpenFile, layout.explorerOpen, layout.editorOpen, setExplorerOpen, setEditorOpen]
    )
    useRegisterCommands(commands)
}
