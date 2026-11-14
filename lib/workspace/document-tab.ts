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

/** True when a tab comes after the one with this id, for Close Tabs to the Right. */
export function anyTabsToRight(tabs: readonly DocumentTab[], id: string | null): boolean {
    const index = tabs.findIndex((t) => t.id === id)
    return index !== -1 && index < tabs.length - 1
}

/** True when a tab has no unsaved changes, for Close Saved Tabs. */
export function anySavedTabs(tabs: readonly DocumentTab[]): boolean {
    return tabs.some((t) => !t.isDirty)
}

/**
 * Files bigger than this open read-only until the user chooses to edit them: every change is previewed
 * and saved in full, which makes typing in them slow.
 */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024

export function isLargeFile(size: number | null | undefined): size is number {
    return typeof size === 'number' && size > LARGE_FILE_BYTES
}

/** A file size the way people read it, such as "6.2 MB" or "23 MB". */
export function formatFileSize(bytes: number): string {
    const mb = bytes / (1024 * 1024)
    if (mb >= 10) return `${Math.round(mb)} MB`
    if (mb >= 0.1) return `${mb.toFixed(1)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * A tab for a file just read from disk. Text that couldn't be read safely opens read-only, so a save can't
 * damage it, and so does a very large file, so it can't slow everything down without the user choosing to.
 */
export function tabFromFile(path: string, file: TextFileRead): DocumentTab {
    const tab: DocumentTab = { ...tabFromPath(path, file.content), format: file.format, disk: { stamp: file.stamp } }
    if (file.issue) {
        tab.readOnly = true
        tab.encodingIssue = file.issue
    }
    if (isLargeFile(file.stamp?.size)) {
        tab.readOnly = true
        tab.largeFile = true
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
    delete tab.largeFile
    return tab
}
