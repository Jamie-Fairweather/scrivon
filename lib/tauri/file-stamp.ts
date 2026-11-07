import { stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import type { FileStamp } from '@/lib/workspace/types'

/**
 * A file's size and the time it was last changed, to tell whether it changed since it was last read
 * (compare two with stampChanged from lib/tauri/fs). Null outside the desktop app, or when the file
 * can't be looked at; the time is null when the system doesn't give one.
 */
export async function getWorkspaceFileStamp(path: string): Promise<FileStamp | null> {
    if (!isTauri()) return null
    try {
        const info = await stat(path)
        if (typeof info.size !== 'number') return null
        const mtimeMs = info.mtime instanceof Date ? info.mtime.getTime() : null
        return { mtimeMs: mtimeMs !== null && Number.isFinite(mtimeMs) ? mtimeMs : null, size: info.size }
    } catch {
        return null
    }
}
