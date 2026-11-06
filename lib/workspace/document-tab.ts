import type { UnsavedBackup } from '@/lib/tauri/backups'
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

/**
 * The tab for a file whose unsaved text was kept when Scrivon closed without saving it. `fromDisk` is the
 * file as read now, or null when it can't be read (deleted or moved). The text comes back unsaved, and
 * the tab remembers the version of the file it was written on, so a save asks first if that has changed.
 */
export function tabWithRecoveredText(fromDisk: DocumentTab | null, backup: UnsavedBackup): DocumentTab {
    const tab: DocumentTab = {
        ...(fromDisk ?? tabFromPath(backup.path, backup.content)),
        content: backup.content,
        isDirty: true,
        disk: { stamp: backup.stamp },
    }
    if (backup.format) tab.format = backup.format
    // The user was typing in it, so it was editable; a read-only reason from the file now doesn't apply to this text.
    delete tab.readOnly
    delete tab.encodingIssue
    return tab
}
