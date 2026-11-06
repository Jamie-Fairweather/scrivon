'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { FileTreeNode } from '@/components/studio/explorer/file-tree-node'
import { useFileTreeEntryActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { isSupportedDocument } from '@/lib/tauri/fs'
import { treeKeyAction, visibleTreeRows } from '@/lib/workspace/flatten-file-tree'
import type { FileNode } from '@/lib/workspace/types'

/** Folders in the first two levels start open. */
const openByDefault = (level: number) => level <= 2

/**
 * The workspace files as an ARIA tree: one Tab stop, arrow keys to move and open folders, Enter to open,
 * F2 to rename, Delete to delete, and Shift+F10 or the menu key for the row menu.
 */
export function FileTree({ tree }: { tree: FileNode[] }) {
    const { activeTabId, openFile } = useDocumentTabs()
    const { renameWithPrompt, deleteWithConfirm } = useFileTreeEntryActions()
    const treeRef = useRef<HTMLDivElement>(null)
    // Folders the user opened or closed; the rest follow openByDefault.
    const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())
    const [focusedPath, setFocusedPath] = useState<string | null>(null)

    const rows = useMemo(() => visibleTreeRows(tree, (path, level) => toggled.get(path) ?? openByDefault(level)), [tree, toggled])

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

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const target = e.target as HTMLElement
            // Keys typed in a row's open menu also arrive here through the portal; only rows are handled.
            if (target.getAttribute('role') !== 'treeitem' || !e.currentTarget.contains(target)) return
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
            const row = rows.find((r) => r.node.path === target.dataset.path)
            if (!row) return

            if (e.key === 'F2') {
                void renameWithPrompt(row.node)
            } else if (e.key === 'Delete') {
                void deleteWithConfirm(row.node)
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
        [rows, renameWithPrompt, deleteWithConfirm, focusRow, setExpanded, activate]
    )

    return (
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
    )
}
