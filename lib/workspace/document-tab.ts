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

/**
 * The list with the item at `from` moved so it ends up at `to`, kept inside the list. The same list (not a
 * copy) when nothing moves, so the caller can tell.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
    if (from < 0 || from >= list.length) return list
    const target = Math.min(Math.max(to, 0), list.length - 1)
    if (target === from) return list
    const moved = list.slice()
    const [item] = moved.splice(from, 1)
    moved.splice(target, 0, item!)
    return moved
}

/**
 * Where a tab dragged to `x` would be let go, as the gap before that tab (0 to the number of tabs): before the
 * first tab whose middle is to the right of the pointer, else at the end. `tabRects` are the tabs in order, as
 * `getBoundingClientRect()` gives them.
 *
 * With `visible`, the part of the strip that can be seen when its tabs don't all fit, the pointer counts as at
 * that part's nearest edge when it is beside the strip (over the buttons either side), and the gap is one whose
 * edge can be seen, so the line showing it isn't scrolled out of view.
 */
export function dropIndexAt(
    x: number,
    tabRects: readonly Pick<DOMRect, 'left' | 'width'>[],
    visible?: { left: number; right: number }
): number {
    const at = visible ? Math.min(Math.max(x, visible.left), visible.right) : x
    const found = tabRects.findIndex((rect) => at < rect.left + rect.width / 2)
    let index = found === -1 ? tabRects.length : found
    if (!visible || tabRects.length === 0) return index
    // A gap's line runs down the left edge of the tab after it, or the right edge of the last tab.
    const last = tabRects[tabRects.length - 1]!
    const edge = (gap: number) => (gap < tabRects.length ? tabRects[gap]!.left : last.left + last.width)
    const hiddenRight = (gap: number) => (gap < tabRects.length ? edge(gap) >= visible.right : edge(gap) > visible.right)
    while (index > 0 && hiddenRight(index)) index--
    while (index < tabRects.length && edge(index) < visible.left) index++
    return index
}

/** The index the tab at `from` ends up at when let go in the gap `dropIndex` (from dropIndexAt). */
export function indexAfterDrop(from: number, dropIndex: number): number {
    return dropIndex > from ? dropIndex - 1 : dropIndex
}

/** What a screen reader hears once a tab has moved: "notes.md moved to position 2 of 4". */
export function tabMovedMessage(label: string, index: number, count: number): string {
    return `${label} moved to position ${index + 1} of ${count}`
}
