import { isPathInside, joinPath, normalizePath, pathInside, samePath } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

/** Where `path` is once `oldPath` is renamed to `newPath`: the renamed entry itself, something inside it, or unchanged. */
export function remapPathAfterRename(path: string, oldPath: string, newPath: string): string {
    if (samePath(path, oldPath)) return normalizePath(newPath)
    const rest = pathInside(path, oldPath)
    return rest !== null ? joinPath(newPath, rest) : path
}

export function remapTabsAfterRename(tabs: DocumentTab[], oldPath: string, newPath: string, newName: string): DocumentTab[] {
    return tabs.map((t) => {
        const updated = remapPathAfterRename(t.path, oldPath, newPath)
        if (updated === t.path) return t
        return samePath(t.path, oldPath) ? { ...t, id: updated, path: updated, name: newName } : { ...t, id: updated, path: updated }
    })
}

/** A map keyed by path once `oldPath` is renamed to `newPath`: the entries for it and anything inside it move with it. */
export function remapPathKeysAfterRename<T>(entries: ReadonlyMap<string, T>, oldPath: string, newPath: string): Map<string, T> {
    return new Map([...entries].map(([path, value]) => [remapPathAfterRename(path, oldPath, newPath), value]))
}

/** A map keyed by path without the entries for `deletedPath` and anything inside it. */
export function dropPathKeysAfterDelete<T>(entries: ReadonlyMap<string, T>, deletedPath: string): Map<string, T> {
    return new Map([...entries].filter(([path]) => !samePath(path, deletedPath) && !isPathInside(path, deletedPath)))
}

export function tabsToCloseOnDelete(tabs: DocumentTab[], deletedPath: string, isDirectory: boolean): DocumentTab[] {
    return tabs.filter((t) => samePath(t.path, deletedPath) || (isDirectory && isPathInside(t.path, deletedPath)))
}
