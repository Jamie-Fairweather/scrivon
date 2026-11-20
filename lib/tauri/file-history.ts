import { invoke } from '@tauri-apps/api/core'
import { comparablePath, isFileMissingError, normalizePath, readStamp, readWorkspaceTextFile } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { isLargeFile, LARGE_FILE_BYTES } from '@/lib/workspace/document-tab'

/**
 * Local history: a copy of each saved version of a file, kept by the app in its own local data folder
 * (`%LOCALAPPDATA%\io.github.jamie-fairweather.scrivon\history`), never next to the file. The app keeps them
 * (src-tauri/src/file_history.rs); outside the desktop app nothing is kept.
 *
 * This is not the same as the copies of unsaved text in backups.ts: those keep edits that aren't saved yet, and
 * go once the file is saved. These keep what was saved.
 */

/** Why a version was kept. */
export type FileVersionKind =
    /** A save the user asked for (Ctrl+S, Save All). */
    | 'manual'
    /** Autosave. Autosaves a few minutes apart are merged into one version. */
    | 'autosave'
    /** The file as it was on disk before Scrivon first wrote it this session. */
    | 'before-first-write'
    /** The version another program saved, before the user chose to overwrite it. */
    | 'before-overwrite'
    /** The text in the editor before a version was put back. */
    | 'before-restore'

/** The kinds that copy the file on disk, rather than text the user saved. */
export type DiskVersionKind = Extract<FileVersionKind, 'before-first-write' | 'before-overwrite'>

export type FileVersion = {
    /** 32 hex digits. */
    id: string
    /** When it was first kept (ms since 1970). */
    createdMs: number
    /** When its text was last written: later than `createdMs` once autosaves were merged into it. */
    savedMs: number
    /** Its size in bytes, as UTF-8. */
    size: number
    kind: FileVersionKind
}

/** The app keeps no copies of files bigger than this. */
export const MAX_HISTORY_FILE_BYTES = LARGE_FILE_BYTES

/** True when `text` is too big to keep a version of (more than 5 MB as UTF-8). */
export function isTooLargeForHistory(text: string): boolean {
    // Each UTF-16 unit is at least 1 byte in UTF-8 and at most 3, so only text in between needs counting.
    if (text.length > MAX_HISTORY_FILE_BYTES) return true
    if (text.length * 3 <= MAX_HISTORY_FILE_BYTES) return false
    return new TextEncoder().encode(text).length > MAX_HISTORY_FILE_BYTES
}

/** Each file's history calls still to finish, by path, so they reach the app in the order they were made. */
const queues = new Map<string, Promise<void>>()

/**
 * Runs `task` once every history call made before it for the same file has finished. The app runs each call
 * on a thread of its own, and they wait for one lock, which doesn't go to them in turn: without this, the
 * text of an older save could be kept after a newer one's, and look like the newest.
 */
function inTurn<T>(path: string, task: () => Promise<T>): Promise<T> {
    const key = comparablePath(path)
    const run = (queues.get(key) ?? Promise.resolve()).then(task)
    const settled = run.then(
        () => undefined,
        () => undefined
    )
    queues.set(key, settled)
    void settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key)
    })
    return run
}

/**
 * Keeps `text` as a version of the file at `path`. Resolves true when it was kept, false when it wasn't
 * needed (the same text as the newest version, a file over 5 MB, or outside the desktop app). Versions of one
 * file are kept in the order they were asked for.
 */
export async function recordFileVersion(path: string, text: string, kind: FileVersionKind): Promise<boolean> {
    if (!isTauri() || isTooLargeForHistory(text)) return false
    return inTurn(path, async () => (await invoke<boolean>('record_file_version', { path: normalizePath(path), text, kind })) === true)
}

/** The versions kept of the file at `path`, newest first. None outside the desktop app. */
export async function listFileVersions(path: string): Promise<FileVersion[]> {
    if (!isTauri()) return []
    const versions = await invoke<FileVersion[] | null>('list_file_versions', { path: normalizePath(path) })
    return Array.isArray(versions) ? versions : []
}

/** The text of one kept version of the file at `path`. */
export async function readFileVersion(path: string, id: string): Promise<string> {
    if (!isTauri()) throw new Error('File history is only kept in the desktop app.')
    return invoke<string>('read_file_version', { path: normalizePath(path), id })
}

/** Deletes every kept version of every file. */
export async function deleteAllFileHistory(): Promise<void> {
    if (!isTauri()) return
    await invoke('delete_file_history')
}

/**
 * Keeps the file at `path` as it is on disk now, before Scrivon writes over it. The text is decoded here
 * (BOM, UTF-16, the Windows-1252 fallback), as opening it would be, so the version reads as the file did.
 * Nothing is kept when the file isn't there, is over 5 MB, or doesn't look like text. Other failures throw.
 * Once `signal` is aborted (the save stopped waiting and wrote the file), a read that finishes late keeps
 * nothing, as it may have read the new text.
 */
export async function keepDiskVersion(path: string, kind: DiskVersionKind, signal?: AbortSignal): Promise<boolean> {
    if (!isTauri() || signal?.aborted) return false
    // Looked at first, so a big file is never read in full (and decoded) only to be left out.
    if (isLargeFile((await readStamp(path))?.size)) return false
    if (signal?.aborted) return false
    let file: Awaited<ReturnType<typeof readWorkspaceTextFile>>
    try {
        file = await readWorkspaceTextFile(path)
    } catch (err) {
        // A new file, or one deleted outside Scrivon: there is nothing on disk to keep.
        if (isFileMissingError(err)) return false
        throw err
    }
    if (signal?.aborted || isLargeFile(file.stamp?.size) || file.issue === 'binary') return false
    return recordFileVersion(path, file.content, kind)
}
