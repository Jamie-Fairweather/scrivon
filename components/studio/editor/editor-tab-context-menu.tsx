'use client'

import { useCallback } from 'react'
import { MenuItem, MenuSeparator } from '@/components/ui/menu'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { useFileHistory } from '@/components/studio/dialogs/file-history-provider'
import { PathMenuItems } from '@/components/studio/explorer/path-menu-items'
import { useSaveExampleCopy } from '@/components/studio/workspace/use-save-example-copy'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { useEditorGroup } from '@/components/studio/workspace/editor-group-context'
import { useTabGroupActions } from '@/components/studio/workspace/group-commands'
import { exampleIdFromTabId } from '@/lib/examples/example-tab'
import { anySavedTabs, anyTabsToRight } from '@/lib/workspace/document-tab'

/** Its own component, so only an example tab's menu reads the folder it saves into. */
function SaveExampleCopyItem({ exampleId }: { exampleId: string }) {
    const saveExampleCopy = useSaveExampleCopy()
    return <MenuItem onClick={() => void saveExampleCopy(exampleId)}>Save Copy to Workspace</MenuItem>
}

export function EditorTabRowContextMenu({ tabId, children }: { tabId: string; children: React.ReactNode }) {
    const { closeTab, closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs, revertTab, moveTab } = useDocumentTabs()
    // The tab's own group: closing and moving act on its strip, and splitting on the group beside it.
    const { tabs, index: group } = useEditorGroup()
    const groupActions = useTabGroupActions(tabId, group)
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()
    const { showFileHistory } = useFileHistory()

    // The menu doesn't switch tabs, so closing a background tab leaves you on the one you were in.
    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            openAt({ x: e.clientX, y: e.clientY })
        },
        [openAt]
    )

    const canCloseOthers = tabs.length > 1
    const index = tabs.findIndex((t) => t.id === tabId)
    const tab = tabs[index]
    const hasTabsToRight = anyTabsToRight(tabs, tabId)
    const hasSavedTabs = anySavedTabs(tabs)
    const exampleId = exampleIdFromTabId(tabId)

    return (
        // data-menu-open lets the tab show which one the open menu is for.
        <span onContextMenu={onContextMenu} className="contents" data-menu-open={open || undefined}>
            {children}
            <ContextMenuAtPoint open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" className="min-w-44">
                <MenuItem onClick={() => void closeTab(tabId, group)}>Close</MenuItem>
                <MenuItem disabled={!canCloseOthers} onClick={() => void closeOtherTabs(tabId, group)}>
                    Close Others
                </MenuItem>
                <MenuItem disabled={!hasTabsToRight} onClick={() => void closeTabsToRight(tabId, group)}>
                    Close to the Right
                </MenuItem>
                <MenuItem disabled={!hasSavedTabs} onClick={() => void closeSavedTabs(group)}>
                    Close Saved
                </MenuItem>
                <MenuItem disabled={tabs.length === 0} onClick={() => void closeAllTabs(group)}>
                    Close All
                </MenuItem>
                {tab && (
                    <>
                        <MenuSeparator />
                        <MenuItem disabled={index === 0} onClick={() => moveTab(tabId, index - 1, group)}>
                            Move Left
                        </MenuItem>
                        <MenuItem disabled={index === tabs.length - 1} onClick={() => moveTab(tabId, index + 1, group)}>
                            Move Right
                        </MenuItem>
                        <MenuSeparator />
                        {/* This tab, in the group beside its own (made first when there is one group). */}
                        <MenuItem onClick={groupActions.split}>Split Editor</MenuItem>
                        <MenuItem disabled={!groupActions.canMove} onClick={groupActions.move}>
                            Move Tab to Other Group
                        </MenuItem>
                        <MenuSeparator />
                    </>
                )}
                {/* Examples have no file on disk, but can be saved as one. */}
                {tab && exampleId !== null && <SaveExampleCopyItem exampleId={exampleId} />}
                {tab && exampleId === null && (
                    <>
                        <MenuItem onClick={() => void revertTab(tabId)}>Revert File</MenuItem>
                        {/* Makes this the active tab first: the dialog compares with the editor's text. */}
                        <MenuItem onClick={() => void showFileHistory(tabId)}>Show File History…</MenuItem>
                        <MenuSeparator />
                        {/* The Close items have no icons, so leave them off here too. */}
                        <PathMenuItems path={tab.path} icons={false} />
                    </>
                )}
            </ContextMenuAtPoint>
        </span>
    )
}
