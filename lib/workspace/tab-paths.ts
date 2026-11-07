import { isPathInside, joinPath, normalizePath, pathInside, samePath } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

export function remapTabsAfterRename(tabs: DocumentTab[], oldPath: string, newPath: string, newName: string): DocumentTab[] {
    return tabs.map((t) => {
        if (samePath(t.path, oldPath)) {
            const updated = normalizePath(newPath)
            return { ...t, id: updated, path: updated, name: newName }
        }
        const rest = pathInside(t.path, oldPath)
        if (rest !== null) {
            const updated = joinPath(newPath, rest)
            return { ...t, id: updated, path: updated }
        }
        return t
    })
}

export function tabsToCloseOnDelete(tabs: DocumentTab[], deletedPath: string, isDirectory: boolean): DocumentTab[] {
    return tabs.filter((t) => samePath(t.path, deletedPath) || (isDirectory && isPathInside(t.path, deletedPath)))
}
