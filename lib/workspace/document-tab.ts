import { getBaseName, normalizePath } from '@/lib/tauri/fs'
import type { TextFileRead } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

export function tabFromPath(path: string, content: string): DocumentTab {
    const normalized = normalizePath(path)
    return {
        id: normalized,
        path: normalized,
        name: getBaseName(normalized),
        content,
        isDirty: false,
        isSaving: false,
    }
}

/** A tab for a file just read from disk. Text that couldn't be read safely opens read-only, so a save can't damage it. */
export function tabFromFile(path: string, file: TextFileRead): DocumentTab {
    const tab: DocumentTab = { ...tabFromPath(path, file.content), format: file.format, disk: { stamp: file.stamp } }
    if (file.issue) {
        tab.readOnly = true
        tab.encodingIssue = file.issue
    }
    return tab
}
