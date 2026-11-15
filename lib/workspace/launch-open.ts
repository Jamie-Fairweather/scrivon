import { getParentPath, isPathInside, samePath } from '@/lib/tauri/fs'
import type { LaunchPath } from '@/lib/tauri/launch'

export type LaunchOpenPlan = {
    /** The folder to open first, or null to stay in the open one. */
    folder: string | null
    /** The files to open in tabs, in order. */
    files: string[]
    /** What isn't in that folder, so isn't opened: Scrivon has one folder open at a time. */
    skipped: string[]
}

/**
 * How to open what Scrivon was asked to open from outside (File Explorer, the command line). The first
 * path picks the folder: the open one when that file is in it, so its tabs stay, or else the file's own
 * folder (or the folder itself). Every file in that folder then opens in a tab.
 */
export function planLaunchOpen(paths: readonly LaunchPath[], openRoot: string | null): LaunchOpenPlan {
    const first = paths[0]
    if (!first) return { folder: null, files: [], skipped: [] }
    const stays = openRoot !== null && !first.isFolder && isPathInside(first.path, openRoot)
    const root = stays ? openRoot : first.isFolder ? first.path : getParentPath(first.path)
    const files: string[] = []
    const skipped: string[] = []
    for (const { path, isFolder } of paths) {
        if (isFolder ? !samePath(path, root) : !isPathInside(path, root)) skipped.push(path)
        else if (!isFolder) files.push(path)
    }
    return { folder: stays ? null : root, files, skipped }
}
