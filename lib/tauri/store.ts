import { invoke } from '@tauri-apps/api/core'
import { getStore as getAppStore, type Store } from '@tauri-apps/plugin-store'
import { errorMessage, notifyWarning } from '@/lib/notify'
import { DEFAULT_MAX_RECENT_FOLDERS } from '@/lib/settings/defaults'
import { isPathInside, normalizePath, samePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { remapPathAfterRename } from '@/lib/workspace/tab-paths'

const STORE_PATH = 'workspace.json'
const RECENT_KEY = 'recent-workspaces'
const RECENT_FILES_PREFIX = 'recent-files:'
const LAST_FILE_PREFIX = 'last-file:'
const OPEN_TABS_PREFIX = 'open-tabs:'
const OPEN_FOLDERS_PREFIX = 'open-folders:'
const MAX_RECENT_FILES = 20
/** Folders opened or closed by hand that are remembered per workspace; the oldest choices go first. */
const MAX_FOLDER_TOGGLES = 500

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
/** The store plugin's error for a file it read but couldn't parse. */
const FILE_DAMAGED = /^Failed to deserialize store\b/
/** A file another program holds for a moment (access denied, or a sharing or lock violation): tried again shortly. */
const FILE_BUSY = /\(os error (5|32|33)\)/
const BUSY_RETRIES = 3
const BUSY_RETRY_MS = 200
const STORE_UNREADABLE_NOTICE_ID = 'workspace-store-unreadable'

const STORE_SAVE_FAILED_NOTICE_ID = 'workspace-store-save-failed'

let storeReady: Promise<Store | null> | null = null
let saveFailureShown = false

/**
 * The store; null outside the desktop app, and for the rest of the run when workspace.json couldn't be read
 * (see leaveUnreadableStore): the lists are then empty, and nothing is saved.
 */
async function getStore(): Promise<Store | null> {
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
async function saveStore(s: Store): Promise<void> {
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

/**
 * One of the store files the app opens at startup (src-tauri/src/lib.rs). The webview can't open a store
 * itself, so a script in the window can't write a store file anywhere on disk.
 */
async function openAppStore(path: string): Promise<Store> {
    const s = await getAppStore(path)
    if (!s) throw new Error(`Scrivon couldn't open ${path}.`)
    return s
}

/** Reads workspace.json into the store again. Returns why it couldn't, or null when it could. */
async function readStoreFile(s: Store): Promise<unknown> {
    try {
        await s.reload()
        return null
    } catch (err) {
        return err ?? new Error("Couldn't read workspace.json.")
    }
}

/** Null when workspace.json can't be used this run (see leaveUnreadableStore). */
async function openStore(): Promise<Store | null> {
    const s = await getAppStore(STORE_PATH)
    if (!s) {
        // The app shell couldn't open it at startup, or it was closed earlier in this run because it couldn't be
        // read (and the window was reloaded since).
        warnStoreUnreadable(new Error("Scrivon couldn't open workspace.json."))
        return null
    }
    // Opening ignores a file it can't read or parse and starts empty; reading the file again says why.
    let readError = await readStoreFile(s)
    for (let tries = 0; readError !== null && FILE_BUSY.test(errorMessage(readError, '')) && tries < BUSY_RETRIES; tries++) {
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS))
        readError = await readStoreFile(s)
    }
    const message = errorMessage(readError, '')
    if (readError === null) void keepStoreBackup(s)
    else if (FILE_DAMAGED.test(message)) await recoverStore(s, readError, null)
    else if (FILE_MISSING.test(message)) {
        // Missing because the app shell moved a damaged file aside, or simply not there yet (a first launch).
        const keptAs = await takeDamagedStoreName()
        if (keptAs) await recoverStore(s, readError, keptAs)
    } else if (await leaveUnreadableStore(s, readError)) return null
    return s
}

/**
 * workspace.json is there but couldn't be read just now (locked, or on a network drive that is offline). It is
 * left as it is: for the rest of this run nothing is read from it or saved to it. Not saving isn't enough, as
 * the store plugin also saves every store it has open when the app quits, and this one is empty: once the file
 * can be written again, that would put an empty list over it. So the store is closed, which the plugin skips.
 * Returns false when the store can be used after all.
 */
async function leaveUnreadableStore(s: Store, readError: unknown): Promise<boolean> {
    console.warn("Couldn't read workspace.json", readError)
    // Still held from earlier in this run (the window was reloaded): that came from the file, so it can be saved.
    if ((await s.length()) > 0) return false
    try {
        await s.close()
    } catch (err) {
        console.warn("Couldn't close workspace.json", err)
    }
    warnStoreUnreadable(readError)
    return true
}

function warnStoreUnreadable(err: unknown): void {
    notifyWarning("Couldn't read recent folders", {
        id: STORE_UNREADABLE_NOTICE_ID,
        description: `${errorMessage(err)} The file was left as it is, and recent folders and open tabs won't be remembered until Scrivon is restarted. Your documents aren't affected.`,
    })
}

/**
 * The name the app shell gave a workspace.json it couldn't read, which it moved aside at startup so nothing
 * saves over it (src-tauri/src/store_recovery.rs). Handed out once per launch; null when nothing was moved.
 */
async function takeDamagedStoreName(): Promise<string | null> {
    try {
        const name = await invoke<unknown>('take_store_recovery')
        return typeof name === 'string' && name ? name : null
    } catch (err) {
        console.warn("Couldn't check whether workspace.json was damaged", err)
        return null
    }
}

async function openBackupStore(): Promise<Store> {
    // Written by hand, once per launch.
    return openAppStore(BACKUP_STORE_PATH)
}

async function keepStoreBackup(s: Store): Promise<void> {
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

/**
 * workspace.json couldn't be read: it is filled from the copy, before anything can save over it. `keptAs`
 * names the damaged file when the app shell kept it aside.
 */
async function recoverStore(s: Store, readError: unknown, keptAs: string | null): Promise<void> {
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
    const kept = keptAs ? ` The damaged file was kept as ${keptAs} in Scrivon's data folder.` : ''
    if (restored) {
        notifyWarning('Recent folders restored', {
            id: STORE_DAMAGED_NOTICE_ID,
            description: `${what}, so it brought back the copy from when Scrivon last started.${kept} Your documents aren't affected.`,
        })
    } else {
        notifyWarning('Recent folders were reset', {
            id: STORE_DAMAGED_NOTICE_ID,
            description: `${what}, so those lists start empty.${kept} Your documents aren't affected.`,
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

/**
 * Empties workspace.json: the recent folders, and each folder's open tabs, opened folders and recent files.
 * The crash screens offer it for when something kept there makes Scrivon fail on every start. Documents and
 * the copies of unsaved edits (lib/tauri/backups.ts) are kept. Errors reach the caller.
 */
export async function clearWorkspaceStore(): Promise<void> {
    if (!isTauri()) return
    const s = await getStore()
    // Nothing from it is in use this run, and it is left alone (see leaveUnreadableStore).
    if (!s) throw new Error("Scrivon couldn't read them when it started, so it left them as they are.")
    await s.clear()
    await s.save()
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
async function forgetWorkspace(s: Store, root: string): Promise<void> {
    const prefixes = [OPEN_TABS_PREFIX, OPEN_FOLDERS_PREFIX, LAST_FILE_PREFIX, RECENT_FILES_PREFIX]
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

/**
 * The folders the user opened or closed in this workspace's file tree, as `[path, open]` pairs; every
 * other folder follows the tree's default. Entries that aren't such a pair are skipped.
 */
export async function getFolderToggles(workspaceRoot: string): Promise<Array<[string, boolean]>> {
    const s = await getStore()
    if (!s) return []
    const stored = await s.get<unknown>(`${OPEN_FOLDERS_PREFIX}${workspaceRoot}`)
    if (!Array.isArray(stored)) return []
    const toggles = new Map<string, boolean>()
    for (const entry of stored) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].trim() || typeof entry[1] !== 'boolean') continue
        toggles.set(normalizePath(entry[0]), entry[1])
    }
    return [...toggles]
}

/** Remembers the folders the user opened or closed, keeping the latest choices when there are very many. */
export async function setFolderToggles(workspaceRoot: string, toggles: ReadonlyMap<string, boolean>): Promise<void> {
    const s = await getStore()
    if (!s) return
    await s.set(`${OPEN_FOLDERS_PREFIX}${workspaceRoot}`, [...toggles].slice(-MAX_FOLDER_TOGGLES))
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

/** Moves a renamed file in the folder's recent files to its new path, or every file inside a renamed folder. */
export async function renameRecentFiles(workspaceRoot: string, oldPath: string, newPath: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const current = await getRecentFiles(workspaceRoot)
    const next = toPathList(current.map((p) => remapPathAfterRename(p, oldPath, newPath)))
    return replaceRecentFiles(s, workspaceRoot, current, next)
}

/**
 * Drops a deleted or missing file from the folder's recent files, or every file inside a deleted folder, so
 * dead entries don't take up the list and a new file made later at the same path doesn't show up in it.
 */
export async function removeRecentFiles(workspaceRoot: string, deletedPath: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const current = await getRecentFiles(workspaceRoot)
    const next = current.filter((p) => !samePath(p, deletedPath) && !isPathInside(p, deletedPath))
    return replaceRecentFiles(s, workspaceRoot, current, next)
}

/** Writes a folder's recent files, but only when they changed. */
async function replaceRecentFiles(s: Store, workspaceRoot: string, current: string[], next: string[]): Promise<string[]> {
    if (next.length === current.length && next.every((p, i) => p === current[i])) return current
    await s.set(`${RECENT_FILES_PREFIX}${workspaceRoot}`, next)
    await saveStore(s)
    return next
}
