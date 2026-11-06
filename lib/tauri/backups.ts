import { LazyStore } from '@tauri-apps/plugin-store'
import { isWindowsPath, normalizePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import type { TextFileFormat } from '@/lib/workspace/text-encoding'
import type { FileStamp } from '@/lib/workspace/types'

/**
 * Copies of edits that aren't saved yet, so a crash, a forced Windows restart or a power cut can't lose
 * them. They are kept in the app's own data folder, never next to the user's files, and are removed once
 * the file is saved or the user closes it without saving.
 */
const BACKUP_STORE_PATH = 'unsaved-changes.json'

export type UnsavedBackup = {
    path: string
    /** The folder that was open, so the app can offer to open it again after a crash. */
    root: string | null
    content: string
    format?: TextFileFormat
    /** The file's stamp from when it was last read or saved: the version the edits were made on. */
    stamp: FileStamp | null
    savedAt: number
}

let store: LazyStore | null = null
// One operation at a time, so a delete never lands before the write it follows.
let queue: Promise<unknown> = Promise.resolve()

function run<T>(operation: (s: LazyStore) => Promise<T>, fallback: T): Promise<T> {
    if (!isTauri()) return Promise.resolve(fallback)
    const next = queue.then(async () => {
        if (!store) {
            // Saved by hand right after each change, so a crash just after it can't lose it.
            const created = new LazyStore(BACKUP_STORE_PATH, { defaults: {}, autoSave: false })
            await created.init()
            store = created
        }
        return operation(store)
    })
    queue = next.catch(() => undefined)
    return next
}

function backupKey(path: string): string {
    const normalized = normalizePath(path)
    // Windows file names ignore case, so one file has one backup whatever case its path is written in.
    return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized
}

function isStamp(value: unknown): value is FileStamp {
    if (!value || typeof value !== 'object') return false
    const stamp = value as Record<string, unknown>
    return typeof stamp.size === 'number' && (stamp.mtimeMs === null || typeof stamp.mtimeMs === 'number')
}

function isFormat(value: unknown): value is TextFileFormat {
    if (!value || typeof value !== 'object') return false
    const format = value as Record<string, unknown>
    return (format.encoding === 'utf-8' || format.encoding === 'utf-16le' || format.encoding === 'utf-16be') && typeof format.bom === 'boolean'
}

function readBackup(value: unknown): UnsavedBackup | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (typeof raw.path !== 'string' || typeof raw.content !== 'string') return null
    return {
        path: normalizePath(raw.path),
        root: typeof raw.root === 'string' ? normalizePath(raw.root) : null,
        content: raw.content,
        format: isFormat(raw.format) ? raw.format : undefined,
        stamp: isStamp(raw.stamp) ? raw.stamp : null,
        savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    }
}

/** Keeps a copy of a file's unsaved text, replacing any earlier copy for that file. */
export function saveUnsavedBackup(backup: UnsavedBackup): Promise<void> {
    return run(async (s) => {
        await s.set(backupKey(backup.path), backup)
        await s.save()
    }, undefined)
}

/** Forgets the copy for a file, once it is saved or the user chose not to keep the changes. */
export function deleteUnsavedBackup(path: string): Promise<void> {
    return run(async (s) => {
        if (await s.delete(backupKey(path))) await s.save()
    }, undefined)
}

/**
 * Waits until every change asked for so far has reached the disk, for at most `timeoutMs`. Closing the
 * window or a folder waits for this, so a copy removed just before can't come back on the next launch.
 */
export function settleUnsavedBackups(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
    return Promise.race([queue.then(() => undefined), timeout]).finally(() => clearTimeout(timer))
}

/** Every copy of unsaved text still kept, newest first. */
export function listUnsavedBackups(): Promise<UnsavedBackup[]> {
    return run(async (s) => {
        const backups = (await s.values<unknown>()).map(readBackup).filter((b): b is UnsavedBackup => b !== null)
        return backups.sort((a, b) => b.savedAt - a.savedAt)
    }, [])
}
