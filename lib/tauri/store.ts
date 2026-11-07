import { LazyStore } from '@tauri-apps/plugin-store'
import { errorMessage, notifyWarning } from '@/lib/notify'
import { DEFAULT_MAX_RECENT_FOLDERS } from '@/lib/settings/defaults'
import { normalizePath, samePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'

const STORE_PATH = 'workspace.json'
const RECENT_KEY = 'recent-workspaces'
const RECENT_FILES_PREFIX = 'recent-files:'
const LAST_FILE_PREFIX = 'last-file:'
const OPEN_TABS_PREFIX = 'open-tabs:'
const MAX_RECENT_FILES = 20

/** The recent folders limit from settings, kept to 1-50 like the settings screen allows. */
export function clampRecentWorkspaceLimit(limit: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_MAX_RECENT_FOLDERS
    return Math.min(50, Math.max(1, Math.floor(limit)))
}

export type WorkspaceTabSession = {
    tabIds: string[]
    activeTabId: string | null
}

/**
 * A copy of workspace.json, taken each time Scrivon starts and reads it without trouble. The store plugin
 * quietly starts empty when the file can't be read (a crash mid-save can leave it empty or full of zeros),
 * and its next save replaces the file, so this copy is what brings recent folders and open tabs back.
 */
const BACKUP_STORE_PATH = 'workspace.backup.json'
const BACKUP_SNAPSHOT_KEY = 'snapshot'
const STORE_DAMAGED_NOTICE_ID = 'workspace-store-damaged'
/** The OS error for a file (or the app's data folder) that isn't there yet, as on a first launch. */
const FILE_MISSING = /\(os error [23]\)/

const STORE_SAVE_FAILED_NOTICE_ID = 'workspace-store-save-failed'

let storeReady: Promise<LazyStore> | null = null
let saveFailureShown = false

async function getStore(): Promise<LazyStore | null> {
    if (!isTauri()) return null
    storeReady ??= openStore().catch((err: unknown) => {
        // Not remembered as broken: the next call tries again.
        storeReady = null
        throw err
    })
    return storeReady
}

/**
 * Writes the store to disk. Recent folders and open tabs are a convenience, so a failed write (full disk,
 * a locked file, an offline network AppData) is reported once and never stops what the user was doing.
 * The values stay in memory for this session either way.
 */
async function saveStore(s: LazyStore): Promise<void> {
    try {
        await s.save()
    } catch (err) {
        console.warn("Couldn't save workspace.json", err)
        if (saveFailureShown) return
        saveFailureShown = true
        notifyWarning("Couldn't save recent folders", {
            id: STORE_SAVE_FAILED_NOTICE_ID,
            description: `${errorMessage(err)} Your recent folders and open tabs may not be remembered next time. Your documents aren't affected.`,
        })
    }
}

async function openStore(): Promise<LazyStore> {
    const s = new LazyStore(STORE_PATH)
    await s.init()
    // init() ignores a file it can't read or parse and starts empty; reading the file again says why.
    let readError: unknown = null
    try {
        await s.reload()
    } catch (err) {
        readError = err
    }
    if (readError === null) void keepStoreBackup(s)
    else if (!FILE_MISSING.test(errorMessage(readError, ''))) await recoverStore(s, readError)
    return s
}

async function openBackupStore(): Promise<LazyStore> {
    // Written by hand, once per launch.
    const backup = new LazyStore(BACKUP_STORE_PATH, { defaults: {}, autoSave: false })
    await backup.init()
    return backup
}

async function keepStoreBackup(s: LazyStore): Promise<void> {
    try {
        const snapshot = Object.fromEntries(await s.entries())
        const backup = await openBackupStore()
        await backup.set(BACKUP_SNAPSHOT_KEY, snapshot)
        await backup.save()
    } catch (err) {
        console.warn("Couldn't update the copy of workspace.json", err)
    }
}

async function readStoreBackup(): Promise<Record<string, unknown> | null> {
    const snapshot = await (await openBackupStore()).get<unknown>(BACKUP_SNAPSHOT_KEY)
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
    return Object.keys(snapshot).length > 0 ? (snapshot as Record<string, unknown>) : null
}

/** workspace.json is there but couldn't be read: it is filled from the copy, before anything can save over it. */
async function recoverStore(s: LazyStore, readError: unknown): Promise<void> {
    console.warn("Couldn't read workspace.json", readError)
    // Still held from earlier in this run (the window was reloaded): that is newer than the copy.
    if ((await s.length()) > 0) return
    let restored = false
    try {
        const snapshot = await readStoreBackup()
        if (snapshot) {
            for (const [key, value] of Object.entries(snapshot)) await s.set(key, value)
            await saveStore(s)
            restored = true
        }
    } catch (err) {
        console.warn("Couldn't restore workspace.json from its copy", err)
    }
    const what = "Scrivon couldn't read the file that keeps your recent folders and open tabs"
    if (restored) {
        notifyWarning('Recent folders restored', {
            id: STORE_DAMAGED_NOTICE_ID,
            description: `${what}, so it brought back the copy from when Scrivon last started. Your documents aren't affected.`,
        })
    } else {
        notifyWarning('Recent folders were reset', {
            id: STORE_DAMAGED_NOTICE_ID,
            description: `${what}, so those lists start empty. Your documents aren't affected.`,
        })
    }
}

/**
 * A stored list of paths, keeping only real paths, each once. The file can be edited by hand or written by
 * another version of Scrivon, and one entry that isn't a path mustn't break every screen that lists them.
 * Older entries can also name the same place with different separators.
 */
function toPathList(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    const paths: string[] = []
    for (const entry of value) {
        if (typeof entry !== 'string' || !entry.trim()) continue
        const normalized = normalizePath(entry)
        if (!paths.some((p) => samePath(p, normalized))) paths.push(normalized)
    }
    return paths
}

export async function getRecentWorkspaces(): Promise<string[]> {
    const s = await getStore()
    if (!s) return []
    return toPathList(await s.get<unknown>(RECENT_KEY))
}

/**
 * Forgets what was kept for a folder that left the recent folders: its open tabs, last file and recent
 * files, which name the user's files. Keys written with other separators or letter case go too.
 */
async function forgetWorkspace(s: LazyStore, root: string): Promise<void> {
    const prefixes = [OPEN_TABS_PREFIX, LAST_FILE_PREFIX, RECENT_FILES_PREFIX]
    for (const key of await s.keys()) {
        const prefix = prefixes.find((p) => key.startsWith(p))
        if (prefix && samePath(key.slice(prefix.length), root)) await s.delete(key)
    }
}

/** Puts a folder first in the recent folders, keeping at most `limit` (the live setting). */
export async function addRecentWorkspace(path: string, limit: number): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const current = await getRecentWorkspaces()
    const added = normalizePath(path)
    const next = [added, ...current.filter((p) => !samePath(p, added))].slice(0, clampRecentWorkspaceLimit(limit))
    await s.set(RECENT_KEY, next)
    for (const dropped of current.filter((p) => !next.some((kept) => samePath(kept, p)))) await forgetWorkspace(s, dropped)
    await saveStore(s)
    return next
}

export async function removeRecentWorkspace(path: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const next = (await getRecentWorkspaces()).filter((p) => !samePath(p, path))
    await s.set(RECENT_KEY, next)
    await forgetWorkspace(s, path)
    await saveStore(s)
    return next
}

export async function getLastOpenedFile(workspaceRoot: string): Promise<string | null> {
    const s = await getStore()
    if (!s) return null
    const value = await s.get<string>(`${LAST_FILE_PREFIX}${workspaceRoot}`)
    return typeof value === 'string' ? value : null
}

export async function setLastOpenedFile(workspaceRoot: string, filePath: string): Promise<void> {
    const s = await getStore()
    if (!s) return
    await s.set(`${LAST_FILE_PREFIX}${workspaceRoot}`, filePath)
    await saveStore(s)
}

export async function getWorkspaceTabSession(workspaceRoot: string): Promise<WorkspaceTabSession | null> {
    const s = await getStore()
    if (!s) return null

    const stored = await s.get<WorkspaceTabSession>(`${OPEN_TABS_PREFIX}${workspaceRoot}`)
    if (stored && Array.isArray(stored.tabIds)) {
        const tabIds = stored.tabIds.filter((id): id is string => typeof id === 'string')
        const activeTabId = typeof stored.activeTabId === 'string' ? stored.activeTabId : null
        if (tabIds.length > 0) return { tabIds, activeTabId }
    }

    const lastFile = await getLastOpenedFile(workspaceRoot)
    if (lastFile) return { tabIds: [lastFile], activeTabId: lastFile }

    return null
}

export async function setWorkspaceTabSession(workspaceRoot: string, session: WorkspaceTabSession): Promise<void> {
    const s = await getStore()
    if (!s) return

    await s.set(`${OPEN_TABS_PREFIX}${workspaceRoot}`, session)
    if (session.activeTabId) {
        await s.set(`${LAST_FILE_PREFIX}${workspaceRoot}`, session.activeTabId)
    } else {
        await s.delete(`${LAST_FILE_PREFIX}${workspaceRoot}`)
    }
    await saveStore(s)
}

export async function getRecentFiles(workspaceRoot: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []
    return toPathList(await s.get<unknown>(`${RECENT_FILES_PREFIX}${workspaceRoot}`))
}

export async function addRecentFile(workspaceRoot: string, filePath: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const path = normalizePath(filePath)
    const current = await getRecentFiles(workspaceRoot)
    const next = [path, ...current.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT_FILES)
    await s.set(`${RECENT_FILES_PREFIX}${workspaceRoot}`, next)
    await saveStore(s)
    return next
}
