import type { DocumentTab } from '@/lib/workspace/types'

function isUnderPath(filePath: string, parentPath: string): boolean {
    return filePath.startsWith(parentPath + '/') || filePath.startsWith(parentPath + '\\')
}

export function remapTabsAfterRename(tabs: DocumentTab[], oldPath: string, newPath: string, newName: string): DocumentTab[] {
    return tabs.map((t) => {
        if (t.path === oldPath) {
            return { ...t, id: newPath, path: newPath, name: newName }
        }
        if (isUnderPath(t.path, oldPath)) {
            const suffix = t.path.slice(oldPath.length)
            const updated = newPath + suffix
            return { ...t, id: updated, path: updated }
        }
        return t
    })
}

export function tabsToCloseOnDelete(tabs: DocumentTab[], deletedPath: string, isDirectory: boolean): DocumentTab[] {
    return tabs.filter((t) => t.path === deletedPath || (isDirectory && isUnderPath(t.path, deletedPath)))
}
