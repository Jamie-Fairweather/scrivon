import { isPathInside, normalizePath, samePath } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'

/** The folders the user opened (true) or closed (false) in the file tree, by normalised path. */
export type FolderToggles = ReadonlyMap<string, boolean>

/** Folders in the first two levels start open; deeper ones start closed. */
function openByDefault(level: number): boolean {
    return level <= 2
}

/** Whether a folder shows open: as the user left it, else the default for its level (1 at the top). */
export function isFolderOpen(toggles: FolderToggles, path: string, level: number): boolean {
    return toggles.get(normalizePath(path)) ?? openByDefault(level)
}

/**
 * The closed folders holding the file at `path`, outermost first: open them and its row shows. Empty when it
 * shows already; null when the tree has no such file (not read yet, outside the folder, or not a file path).
 */
export function closedFoldersAbove(tree: readonly FileNode[], toggles: FolderToggles, path: string): string[] | null {
    const closed: string[] = []
    let siblings = tree
    for (let level = 1; ; level++) {
        let next: readonly FileNode[] | null = null
        for (const node of siblings) {
            if (node.kind === 'file' && samePath(node.path, path)) return closed
            if (node.kind === 'directory' && isPathInside(path, node.path)) {
                if (!isFolderOpen(toggles, node.path, level)) closed.push(node.path)
                next = node.children
                break
            }
        }
        if (!next) return null
        siblings = next
    }
}

/** Every open folder in the tree, also those inside closed ones, so Collapse All closes them all. */
export function openFolderPaths(tree: readonly FileNode[], toggles: FolderToggles): string[] {
    const open: string[] = []
    const walk = (nodes: readonly FileNode[], level: number) => {
        for (const node of nodes) {
            if (node.kind !== 'directory') continue
            if (isFolderOpen(toggles, node.path, level)) open.push(node.path)
            walk(node.children, level + 1)
        }
    }
    walk(tree, 1)
    return open
}
