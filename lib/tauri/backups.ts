import { getStore, type Store } from '@tauri-apps/plugin-store'
import { isWindowsPath, normalizePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import type { TextFileFormat } from '@/lib/workspace/text-encoding'
import type { FileStamp } from '@/lib/workspace/types'

/**
 * Copies of edits that aren't saved yet, so a crash, a forced Windows restart or a power cut can't lose
 * them. They are kept in the app's own data folder, never next to the user's files, and are removed once
 * the file is saved or the user closes it without saving.
 *
 * Every change rewrites the whole file, and a power cut during that can leave it empty or full of zeros.
 * So there are two files, written in turn: while one is being rewritten, the other still holds every copy
 * as of the change before. On launch the newer one that reads cleanly is used.
 */
const BACKUP_STORE_PATHS = ['unsaved-changes.json', 'unsaved-changes.2.json'] as const
/** Counts the writes, so launch can tell which of the two files is newer. Never a file path. */
const GENERATION_KEY = '#generation'
/** The OS error for a file that isn't there yet, as on a first launch. */
const FILE_MISSING = /\(os error [23]\)/

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

/** Both files hold the same copies in memory; only the one written next differs on disk. */
type Slots = { stores: [Store, Store]; generation: number; next: 0 | 1 }

let slots: Slots | null = null
// One operation at a time, so a delete never lands before the write it follows.
let queue: Promise<unknown> = Promise.resolve()

/** Opens one of the two files. Its generation is null when it is there but can't be read (damaged). */
async function openSlot(path: string): Promise<{ store: Store; generation: number | null }> {
    // Opened by the app at startup (src-tauri/src/lib.rs), saved by hand right after each change, so a
    // crash just after it can't lose it. The webview can't open a store itself.
    const store = await getStore(path)
    if (!store) throw new Error(`Scrivon couldn't open ${path}.`)
    try {
        // Opening quietly starts empty when the file can't be read; reading it again says so.
        await store.reload({ ignoreDefaults: true })
    } catch (err) {
        const missing = FILE_MISSING.test(err instanceof Error ? err.message : String(err))
        if (!missing) console.warn(`Couldn't read ${path}`, err)
        return { store, generation: missing ? 0 : null }
    }
    const generation = await store.get<unknown>(GENERATION_KEY)
    return { store, generation: typeof generation === 'number' ? generation : 0 }
}

async function openSlots(): Promise<Slots> {
    const [a, b] = await Promise.all(BACKUP_STORE_PATHS.map(openSlot))
    const newest: 0 | 1 = b!.generation !== null && (a!.generation === null || b!.generation > a!.generation) ? 1 : 0
    const from = newest === 0 ? a! : b!
    const other = newest === 0 ? b! : a!
    // The other file takes the newest copies in memory. It is written next, so the newest file stays as it is.
    await other.store.clear()
    for (const [key, value] of await from.store.entries<unknown>()) await other.store.set(key, value)
    return { stores: [a!.store, b!.store], generation: from.generation ?? 0, next: newest === 0 ? 1 : 0 }
}

function run<T>(operation: (s: Slots) => Promise<T>, fallback: T): Promise<T> {
    if (!isTauri()) return Promise.resolve(fallback)
    const next = queue.then(async () => {
        slots ??= await openSlots()
        return operation(slots)
    })
    queue = next.catch(() => undefined)
    return next
}

/** Makes a change in memory and, if anything changed, writes it to the file whose turn it is. */
async function change(s: Slots, apply: (store: Store) => Promise<boolean>): Promise<void> {
    const changed = (await Promise.all(s.stores.map(apply))).some(Boolean)
    if (!changed) return
    const target = s.stores[s.next]
    s.generation += 1
    await target.set(GENERATION_KEY, s.generation)
    await target.save()
    // Only after a write that worked: if it failed part way, the same file is written again, never the good one.
    s.next = s.next === 0 ? 1 : 0
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
    return run(
        (s) =>
            change(s, async (store) => {
                await store.set(backupKey(backup.path), backup)
                return true
            }),
        undefined
    )
}

/** Forgets the copy for a file, once it is saved or the user chose not to keep the changes. */
export function deleteUnsavedBackup(path: string): Promise<void> {
    return run((s) => change(s, (store) => store.delete(backupKey(path))), undefined)
}

/** How long closing waits for copies to be removed by default; they are only a safety net. */
const SETTLE_TIMEOUT_MS = 1_000

/**
 * Waits until every change asked for so far has reached the disk, for at most `timeoutMs`. Closing the
 * window or a folder waits for this, so a copy removed just before can't come back on the next launch.
 */
export function settleUnsavedBackups(timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
    return Promise.race([queue.then(() => undefined), timeout]).finally(() => clearTimeout(timer))
}

/** Every copy of unsaved text still kept, newest first. */
export function listUnsavedBackups(): Promise<UnsavedBackup[]> {
    return run(async (s) => {
        const entries = (await s.stores[0].entries<unknown>()).filter(([key]) => key !== GENERATION_KEY)
        const backups = entries.map(([, value]) => readBackup(value)).filter((b): b is UnsavedBackup => b !== null)
        return backups.sort((a, b) => b.savedAt - a.savedAt)
    }, [])
}
