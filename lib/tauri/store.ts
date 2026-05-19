import { LazyStore } from '@tauri-apps/plugin-store'
import { isTauri } from '@/lib/tauri/platform'

const STORE_PATH = 'workspace.json'
const RECENT_KEY = 'recent-workspaces'
const LAST_FILE_PREFIX = 'last-file:'
const MAX_RECENTS = 10

let store: LazyStore | null = null

async function getStore(): Promise<LazyStore | null> {
    if (!isTauri()) return null
    if (!store) {
        store = new LazyStore(STORE_PATH)
        await store.init()
    }
    return store
}

export async function getRecentWorkspaces(): Promise<string[]> {
    const s = await getStore()
    if (!s) return []
    const value = await s.get<string[]>(RECENT_KEY)
    return Array.isArray(value) ? value : []
}

export async function addRecentWorkspace(path: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const current = await getRecentWorkspaces()
    const next = [path, ...current.filter((p) => p !== path)].slice(0, MAX_RECENTS)
    await s.set(RECENT_KEY, next)
    await s.save()
    return next
}

export async function removeRecentWorkspace(path: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const next = (await getRecentWorkspaces()).filter((p) => p !== path)
    await s.set(RECENT_KEY, next)
    await s.save()
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
    await s.save()
}
