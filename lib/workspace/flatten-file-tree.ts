import { getBaseName, isSupportedDocument, samePath } from '@/lib/tauri/fs'
import { collectFilePaths } from '@/lib/workspace/paths'
import type { FileNode } from '@/lib/workspace/types'

export function flattenSupportedFilePaths(nodes: FileNode[]): string[] {
    const paths = collectFilePaths(nodes)
    return [...paths].filter((path) => isSupportedDocument(getBaseName(path)))
}

/** One row of the file tree as it is shown: entries inside a closed folder are left out. */
export type VisibleTreeRow = {
    node: FileNode
    /** 1 for entries at the top of the workspace. */
    level: number
    /** The folder this entry is in, or null at the top level. */
    parentPath: string | null
    /** Whether a folder is open; undefined for files. */
    expanded: boolean | undefined
    /** 1-based place among the entries of its folder, and how many entries that folder has. */
    position: number
    siblingCount: number
}

/** The rows of the tree from top to bottom, given which folders are open. */
export function visibleTreeRows(nodes: FileNode[], isExpanded: (path: string, level: number) => boolean): VisibleTreeRow[] {
    const rows: VisibleTreeRow[] = []
    const walk = (siblings: FileNode[], level: number, parentPath: string | null) => {
        siblings.forEach((node, index) => {
            const expanded = node.kind === 'directory' ? isExpanded(node.path, level) : undefined
            rows.push({ node, level, parentPath, expanded, position: index + 1, siblingCount: siblings.length })
            if (node.kind === 'directory' && expanded) walk(node.children, level + 1, node.path)
        })
    }
    walk(nodes, 1, null)
    return rows
}

export type TreeKeyAction = { type: 'focus' | 'expand' | 'collapse' | 'activate'; path: string }

/**
 * What a key press on the focused row does, following the usual tree keys: Up/Down move, Right opens a folder
 * or steps into it, Left closes it or steps out to its folder, Home/End jump to the ends, Enter/Space open.
 * Returns null for keys the tree doesn't use, or when there's nowhere to go.
 */
export function treeKeyAction(rows: VisibleTreeRow[], focusedPath: string, key: string): TreeKeyAction | null {
    const index = rows.findIndex((row) => row.node.path === focusedPath)
    if (index === -1) return null
    const row = rows[index]!
    const path = row.node.path
    const focus = (target: VisibleTreeRow | undefined): TreeKeyAction | null => (target ? { type: 'focus', path: target.node.path } : null)

    switch (key) {
        case 'ArrowDown':
            return focus(rows[index + 1])
        case 'ArrowUp':
            return focus(rows[index - 1])
        case 'Home':
            return focus(rows[0])
        case 'End':
            return focus(rows[rows.length - 1])
        case 'ArrowRight':
            if (row.expanded === false) return { type: 'expand', path }
            if (row.expanded && rows[index + 1]?.parentPath === path) return focus(rows[index + 1])
            return null
        case 'ArrowLeft':
            if (row.expanded) return { type: 'collapse', path }
            return focus(rows.find((r) => r.node.path === row.parentPath))
        case 'Enter':
        case ' ':
            return { type: 'activate', path }
        default:
            return null
    }
}

/**
 * The row to focus once a rename or delete is done: the first of `paths` still in the tree (the new name, else the
 * old one when it was kept), otherwise the row now at `index`, where the entry was (the next row after a delete,
 * or the last row when it was at the end). Null for an empty tree.
 */
export function focusTargetAfterChange(rows: VisibleTreeRow[], paths: string[], index: number): string | null {
    for (const path of paths) {
        const row = rows.find((r) => samePath(r.node.path, path))
        if (row) return row.node.path
    }
    if (rows.length === 0) return null
    return rows[Math.min(Math.max(index, 0), rows.length - 1)]!.node.path
}
