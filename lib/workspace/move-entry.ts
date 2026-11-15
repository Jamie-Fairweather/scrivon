import { getBaseName, getParentPath, isPathInside, pathInside, samePath } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'

/** Why an entry can't move into a folder: it is a folder going into itself, or it is already there. */
export type MoveRefusal = 'into-itself' | 'same-folder'

/** Why `path` can't move into `targetFolder`, or null when it can. */
export function moveRefusal(path: string, isDirectory: boolean, targetFolder: string): MoveRefusal | null {
    if (isDirectory && (samePath(path, targetFolder) || isPathInside(targetFolder, path))) return 'into-itself'
    if (samePath(getParentPath(path), targetFolder)) return 'same-folder'
    return null
}

/** The folders inside `root` that hold `path`, outermost first: open them and its row shows in the tree. */
export function foldersHolding(path: string, root: string): string[] {
    const folders: string[] = []
    for (let folder = getParentPath(path); isPathInside(folder, root); folder = getParentPath(folder)) folders.unshift(folder)
    return folders
}

/** A folder the Move to… list offers. */
export type MoveTarget = {
    path: string
    /** Where it is in the open folder, with `/` between names (`docs/old`); the open folder's own name for its top. */
    label: string
    /** The entry is in this folder now. */
    current: boolean
}

/**
 * The folders `node` can be moved to: the top of the open folder, then every folder in it, in tree order. A
 * moving folder and the folders inside it are left out, and so are folders that couldn't be read (a link to a
 * folder outside the open one can't take anything).
 */
export function moveTargets(tree: FileNode[], root: string, node: FileNode): MoveTarget[] {
    const isDirectory = node.kind === 'directory'
    const target = (path: string, label: string): MoveTarget => ({
        path,
        label,
        current: moveRefusal(node.path, isDirectory, path) === 'same-folder',
    })
    const targets = [target(root, getBaseName(root))]
    const walk = (nodes: FileNode[]) => {
        for (const child of nodes) {
            if (child.kind !== 'directory' || child.unreadable) continue
            if (isDirectory && moveRefusal(node.path, true, child.path) === 'into-itself') continue
            targets.push(target(child.path, (pathInside(child.path, root) ?? child.name).replace(/\\/g, '/')))
            walk(child.children)
        }
    }
    walk(tree)
    return targets
}
