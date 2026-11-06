'use client'

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { FileTreeNode } from '@/components/studio/explorer/file-tree-node'
import { TreeEntryActionsProvider, useFileTreeEntryActions, type FileTreeEntryActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { isSupportedDocument } from '@/lib/tauri/fs'
import { focusTargetAfterChange, treeKeyAction, visibleTreeRows } from '@/lib/workspace/flatten-file-tree'
import type { FileNode } from '@/lib/workspace/types'

/** Folders in the first two levels start open. */
const openByDefault = (level: number) => level <= 2

/** Where focus goes once a rename or delete is done; see focusTargetAfterChange. */
type FocusAfterChange = { fromPath: string; paths: string[]; index: number }

/**
 * Whether focus may be put back in the tree once a rename or delete is done: it was lost (its row went away), is
 * still on the row the action started from, or is in the prompt or menu that is closing. Anywhere else, the user
 * has moved on, and it is left there.
 */
function canRefocus(active: Element | null, fromPath: string): boolean {
    if (!active || active === active.ownerDocument.body) return true
    if (active instanceof HTMLElement && active.dataset.path === fromPath) return true
    return active.closest('[data-closed]') !== null
}

/**
 * The workspace files as an ARIA tree: one Tab stop, arrow keys to move and open folders, Enter to open,
 * F2 to rename, Delete to delete, and Shift+F10 or the menu key for the row menu.
 */
export function FileTree({ tree }: { tree: FileNode[] }) {
    const { activeTabId, openFile } = useDocumentTabs()
    const entryActions = useFileTreeEntryActions()
    const treeRef = useRef<HTMLDivElement>(null)
    // Folders the user opened or closed; the rest follow openByDefault.
    const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
    const [focusedPath, setFocusedPath] = useState<string | null>(null)

    const rows = useMemo(() => visibleTreeRows(tree, (path, level) => toggled.get(path) ?? openByDefault(level)), [tree, toggled])
    const rowsRef = useRef(rows)
    useLayoutEffect(() => {
        rowsRef.current = rows
    }, [rows])

    // Tab lands on the row last focused, else the open file, else the first row.
    const tabStopPath =
        rows.find((row) => row.node.path === focusedPath)?.node.path ??
        rows.find((row) => row.node.path === activeTabId)?.node.path ??
        rows[0]?.node.path

    const setExpanded = useCallback((path: string, expanded: boolean) => {
        setToggled((prev) => new Map(prev).set(path, expanded))
    }, [])

    const activate = useCallback(
        (node: FileNode) => {
            if (node.kind === 'directory') {
                const row = rows.find((r) => r.node.path === node.path)
                setExpanded(node.path, !row?.expanded)
            } else if (isSupportedDocument(node.name)) {
                void openFile(node.path)
            }
        },
        [rows, setExpanded, openFile]
    )

    const focusRow = useCallback((path: string) => {
        const items = treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
        for (const item of items) {
            if (item.dataset.path === path) {
                item.focus()
                return
            }
        }
    }, [])

    // A renamed row comes back under a new key and a deleted one is gone, so focus would fall to the page.
    // Once the action is done, focus goes to the renamed row, or to the row that took the deleted one's place.
    const focusAfterChangeRef = useRef<FocusAfterChange | null>(null)
    const [focusAfterChangeCount, requestFocusAfterChange] = useReducer((count: number) => count + 1, 0)

    const focusAfter = useCallback((request: FocusAfterChange) => {
        focusAfterChangeRef.current = request
        // A render of its own, so the effect below runs even when the tree has already re-rendered.
        requestFocusAfterChange()
    }, [])

    useLayoutEffect(() => {
        const request = focusAfterChangeRef.current
        if (!request) return
        focusAfterChangeRef.current = null
        const target = focusTargetAfterChange(rows, request.paths, request.index)
        if (!target) return
        // The Tab stop moves there too, so Tab comes back to where the user was even when focus is left alone.
        setFocusedPath(target)
        if (canRefocus(document.activeElement, request.fromPath)) focusRow(target)
    }, [rows, focusAfterChangeCount, focusRow])

    const { renameWithPrompt, deleteWithConfirm } = entryActions
    const treeEntryActions = useMemo<FileTreeEntryActions>(
        () => ({
            renameWithPrompt: async (node) => {
                const index = rowsRef.current.findIndex((r) => r.node.path === node.path)
                const path = await renameWithPrompt(node)
                // Cancelled, or the rename failed: back to the row itself.
                focusAfter({ fromPath: node.path, paths: path ? [path, node.path] : [node.path], index })
                return path
            },
            deleteWithConfirm: async (node) => {
                const index = rowsRef.current.findIndex((r) => r.node.path === node.path)
                await deleteWithConfirm(node)
                // Still there when cancelled or the delete failed; otherwise the row that moved up into its place.
                focusAfter({ fromPath: node.path, paths: [node.path], index })
            },
        }),
        [renameWithPrompt, deleteWithConfirm, focusAfter]
    )

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const target = e.target as HTMLElement
            // Keys typed in a row's open menu also arrive here through the portal; only rows are handled.
            if (target.getAttribute('role') !== 'treeitem' || !e.currentTarget.contains(target)) return
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
            const row = rows.find((r) => r.node.path === target.dataset.path)
            if (!row) return

            if (e.key === 'F2') {
                void treeEntryActions.renameWithPrompt(row.node)
            } else if (e.key === 'Delete') {
                void treeEntryActions.deleteWithConfirm(row.node)
            } else {
                const action = treeKeyAction(rows, row.node.path, e.key)
                if (!action) return
                if (action.type === 'focus') focusRow(action.path)
                else if (action.type === 'expand') setExpanded(action.path, true)
                else if (action.type === 'collapse') setExpanded(action.path, false)
                else activate(row.node)
            }
            e.preventDefault()
        },
        [rows, treeEntryActions, focusRow, setExpanded, activate]
    )

    return (
        <TreeEntryActionsProvider value={treeEntryActions}>
            <div ref={treeRef} role="tree" aria-label="Files" onKeyDown={handleKeyDown}>
                {rows.map((row) => (
                    <FileTreeNode
                        key={row.node.path}
                        row={row}
                        isActive={row.node.kind === 'file' && row.node.path === activeTabId}
                        isTabStop={row.node.path === tabStopPath}
                        onActivate={activate}
                        onFocusRow={setFocusedPath}
                    />
                ))}
            </div>
        </TreeEntryActionsProvider>
    )
}
