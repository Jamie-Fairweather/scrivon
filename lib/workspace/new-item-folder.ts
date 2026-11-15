import { getParentPath } from '@/lib/tauri/fs'
import { findNodeByPath } from '@/lib/workspace/paths'
import type { FileNode } from '@/lib/workspace/types'

export type NewItemFolderInput = {
    /** The open folder. */
    root: string
    tree: FileNode[]
    /** The explorer row the keyboard is on, if any. */
    selectedPath?: string | null
    /** The open file (the active tab's id), if any. */
    activePath?: string | null
}

/**
 * The folder a new file or folder goes in: the selected explorer row's (a folder itself, or the folder a file
 * is in), else the open file's folder, else the workspace root. A path not in the file tree, such as an example
 * tab or a file since deleted, is skipped.
 */
export function newItemFolder({ root, tree, selectedPath, activePath }: NewItemFolderInput): string {
    for (const path of [selectedPath, activePath]) {
        const node = path ? findNodeByPath(tree, path) : null
        if (node) return node.kind === 'directory' ? node.path : getParentPath(node.path)
    }
    return root
}
