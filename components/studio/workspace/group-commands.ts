'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { focusPaneSoon } from '@/components/studio/shell/pane-focus'
import { useDocumentTabActions, useDocumentTabs, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { canMoveTabToOtherGroup, focusedActiveTabId, type EditorGroups } from '@/lib/workspace/editor-groups'

export type GroupCommandsContext = {
    hasWorkspace: boolean
    groups: EditorGroups
    /** The editor pane shows (else the keyboard goes to the preview of the group it moves to). */
    editorOpen: boolean
    splitEditor: (id?: string, from?: number) => void
    moveTabToOtherGroup: (id?: string, from?: number) => void
    focusOtherGroup: () => void
    joinGroups: () => void
    /** Puts the keyboard in the group the command moved to, once it is on screen. */
    focusGroupSoon: (tabId: string | null, inNewGroup: boolean) => void
}

const NO_FOLDER = 'No folder open'
const KEYWORDS = 'editor group split side by side two columns pane'

/**
 * Split Editor, Move Tab to Other Group, Focus Other Group and Join Groups, for the View menu, the palette and their
 * shortcuts. Each acts on the focused group and its tab, and says why when it can't.
 */
export function buildGroupCommands(ctx: GroupCommandsContext): AppCommand[] {
    const { groups } = ctx
    const activeTabId = ctx.hasWorkspace ? focusedActiveTabId(groups) : null
    const split = groups.groups.length > 1
    const tabReason = !ctx.hasWorkspace ? NO_FOLDER : 'No tab open'
    const oneGroupReason = !ctx.hasWorkspace ? NO_FOLDER : 'The editor isn’t split'
    const canMove = canMoveTabToOtherGroup(groups, activeTabId)
    return [
        {
            id: 'split-editor',
            label: 'Split Editor',
            keywords: `${KEYWORDS} open to the side duplicate view`,
            keybind: 'view.splitEditor',
            disabled: activeTabId === null,
            disabledReason: tabReason,
            run: () => {
                ctx.splitEditor()
                ctx.focusGroupSoon(activeTabId, !split)
            },
        },
        {
            id: 'move-tab-to-other-group',
            label: 'Move Tab to Other Group',
            keywords: `${KEYWORDS} move tab across`,
            keybind: 'view.moveTabToOtherGroup',
            disabled: !canMove,
            disabledReason: activeTabId === null ? tabReason : 'Only one tab open',
            run: () => {
                ctx.moveTabToOtherGroup()
                ctx.focusGroupSoon(activeTabId, !split)
            },
        },
        {
            id: 'focus-other-group',
            label: 'Focus Other Group',
            keywords: `${KEYWORDS} keyboard move switch`,
            keybind: 'view.focusOtherGroup',
            disabled: !ctx.hasWorkspace || !split,
            disabledReason: oneGroupReason,
            run: () => {
                const other = groups.groups[groups.focused === 0 ? 1 : 0]
                ctx.focusOtherGroup()
                ctx.focusGroupSoon(other?.activeTabId ?? null, false)
            },
        },
        {
            id: 'join-groups',
            label: 'Join Groups',
            keywords: `${KEYWORDS} join merge unsplit single one`,
            keybind: 'view.joinGroups',
            disabled: !ctx.hasWorkspace || !split,
            disabledReason: oneGroupReason,
            run: () => {
                ctx.joinGroups()
                ctx.focusGroupSoon(activeTabId, false)
            },
        },
    ]
}

/** Moves the keyboard into the group a command moved to: its editor, else its preview while the editor is hidden. */
function useFocusGroupSoon(editorOpen: boolean) {
    return useMemo(
        () => (tabId: string | null, inNewGroup: boolean) => {
            if (editorOpen && tabId !== null) focusEditorFor(tabId, { inNewGroup })
            else focusPaneSoon(editorOpen ? 'editor' : 'preview')
        },
        [editorOpen]
    )
}

export function useGroupCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { groups } = useDocumentTabs()
    const { splitEditor, moveTabToOtherGroup, focusOtherGroup, joinGroups } = useDocumentTabActions()
    const { layout } = useStudioLayout()
    const hasWorkspace = Boolean(workspaceRoot)
    const focusGroupSoon = useFocusGroupSoon(layout.editorOpen)

    const commands = useMemo(
        () =>
            buildGroupCommands({
                hasWorkspace,
                groups,
                editorOpen: layout.editorOpen,
                splitEditor,
                moveTabToOtherGroup,
                focusOtherGroup,
                joinGroups,
                focusGroupSoon,
            }),
        [hasWorkspace, groups, layout.editorOpen, splitEditor, moveTabToOtherGroup, focusOtherGroup, joinGroups, focusGroupSoon]
    )
    useRegisterCommands(commands)
}

/** For a tab's right-click menu: whether it can move to the other group, and how to split or move it. */
export function useTabGroupActions(tabId: string, groupIndex: number) {
    const { groups } = useDocumentTabs()
    const { splitEditor, moveTabToOtherGroup } = useDocumentTabActions()
    const { layout } = useStudioLayout()
    const focusGroupSoon = useFocusGroupSoon(layout.editorOpen)
    const split = groups.groups.length > 1
    return {
        canMove: canMoveTabToOtherGroup(groups, tabId, groupIndex),
        split: () => {
            splitEditor(tabId, groupIndex)
            focusGroupSoon(tabId, !split)
        },
        move: () => {
            moveTabToOtherGroup(tabId, groupIndex)
            focusGroupSoon(tabId, !split)
        },
    }
}
