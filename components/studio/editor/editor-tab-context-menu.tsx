'use client'

import { useCallback } from 'react'
import { MenuItem, MenuSeparator } from '@/components/ui/menu'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { useFileHistory } from '@/components/studio/dialogs/file-history-provider'
import { PathMenuItems } from '@/components/studio/explorer/path-menu-items'
import { useSaveExampleCopy } from '@/components/studio/workspace/use-save-example-copy'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { exampleIdFromTabId } from '@/lib/examples/example-tab'
import { anySavedTabs, anyTabsToRight } from '@/lib/workspace/document-tab'

/** Its own component, so only an example tab's menu reads the folder it saves into. */
function SaveExampleCopyItem({ exampleId }: { exampleId: string }) {
    const saveExampleCopy = useSaveExampleCopy()
    return <MenuItem onClick={() => void saveExampleCopy(exampleId)}>Save Copy to Workspace</MenuItem>
}

export function EditorTabRowContextMenu({ tabId, children }: { tabId: string; children: React.ReactNode }) {
    const { tabs, closeTab, closeOtherTabs, closeTabsToRight, closeSavedTabs, closeAllTabs, revertTab, moveTab } = useDocumentTabs()
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
                <MenuItem onClick={() => void closeTab(tabId)}>Close</MenuItem>
                <MenuItem disabled={!canCloseOthers} onClick={() => void closeOtherTabs(tabId)}>
                    Close Others
                </MenuItem>
                <MenuItem disabled={!hasTabsToRight} onClick={() => void closeTabsToRight(tabId)}>
                    Close to the Right
                </MenuItem>
                <MenuItem disabled={!hasSavedTabs} onClick={() => void closeSavedTabs()}>
                    Close Saved
                </MenuItem>
                <MenuItem disabled={tabs.length === 0} onClick={() => void closeAllTabs()}>
                    Close All
                </MenuItem>
                {tab && (
                    <>
                        <MenuSeparator />
                        <MenuItem disabled={index === 0} onClick={() => moveTab(tabId, index - 1)}>
                            Move Left
                        </MenuItem>
                        <MenuItem disabled={index === tabs.length - 1} onClick={() => moveTab(tabId, index + 1)}>
                            Move Right
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
