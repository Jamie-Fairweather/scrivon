import { LazyStore } from '@tauri-apps/plugin-store'
import { loadSettings } from '@/lib/settings/storage'
import { isTauri } from '@/lib/tauri/platform'

const STORE_PATH = 'workspace.json'
const RECENT_KEY = 'recent-workspaces'
const RECENT_FILES_PREFIX = 'recent-files:'
const LAST_FILE_PREFIX = 'last-file:'
const OPEN_TABS_PREFIX = 'open-tabs:'
const MAX_RECENT_FILES = 20

function getMaxRecentWorkspaces(): number {
    return loadSettings().workspace.maxRecentFolders
}

export type WorkspaceTabSession = {
    tabIds: string[]
    activeTabId: string | null
}

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
    const next = [path, ...current.filter((p) => p !== path)].slice(0, getMaxRecentWorkspaces())
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
    await s.save()
}

export async function getRecentFiles(workspaceRoot: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []
    const value = await s.get<string[]>(`${RECENT_FILES_PREFIX}${workspaceRoot}`)
    return Array.isArray(value) ? value : []
}

export async function addRecentFile(workspaceRoot: string, filePath: string): Promise<string[]> {
    const s = await getStore()
    if (!s) return []

    const current = await getRecentFiles(workspaceRoot)
    const next = [filePath, ...current.filter((p) => p !== filePath)].slice(0, MAX_RECENT_FILES)
    await s.set(`${RECENT_FILES_PREFIX}${workspaceRoot}`, next)
    await s.save()
    return next
}
