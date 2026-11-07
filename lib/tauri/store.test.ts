import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyWarning } from '@/lib/notify'

/**
 * A stand-in for tauri-plugin-store that behaves like the real one: `disk` holds each file's text,
 * init() loads it and quietly starts empty when it can't, reload() reports why, and save() writes the
 * whole store back.
 */
const fake = vi.hoisted(() => ({
    disk: new Map<string, string>(),
    caches: new Map<string, Map<string, unknown>>(),
    saveError: null as unknown,
    initError: null as unknown,
}))

function parseStoreFile(path: string): Record<string, unknown> {
    const raw = fake.disk.get(path)
    if (raw === undefined) throw 'The system cannot find the file specified. (os error 2)'
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        throw `Failed to deserialize store. ${String(err)}`
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 'Failed to deserialize store. invalid type'
    return parsed as Record<string, unknown>
}

vi.mock('@tauri-apps/plugin-store', () => ({
    LazyStore: class {
        constructor(private readonly path: string) {}
        private get cache(): Map<string, unknown> {
            return fake.caches.get(this.path)!
        }
        async init() {
            if (fake.initError) throw fake.initError
            if (fake.caches.has(this.path)) return
            const cache = new Map<string, unknown>()
            try {
                for (const [key, value] of Object.entries(parseStoreFile(this.path))) cache.set(key, value)
            } catch {
                // The real plugin ignores this too.
            }
            fake.caches.set(this.path, cache)
        }
        async reload() {
            for (const [key, value] of Object.entries(parseStoreFile(this.path))) this.cache.set(key, value)
        }
        async get(key: string) {
            return this.cache.has(key) ? structuredClone(this.cache.get(key)) : undefined
        }
        async set(key: string, value: unknown) {
            this.cache.set(key, structuredClone(value))
        }
        async delete(key: string) {
            return this.cache.delete(key)
        }
        async keys() {
            return [...this.cache.keys()]
        }
        async entries() {
            return [...this.cache.entries()]
        }
        async length() {
            return this.cache.size
        }
        async save() {
            if (fake.saveError) throw fake.saveError
            fake.disk.set(this.path, JSON.stringify(Object.fromEntries(this.cache)))
        }
    },
}))

vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn(() => true) }))
vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
}))

/** A fresh copy of the module, as on a new launch. */
async function launch() {
    vi.resetModules()
    return import('./store')
}

function onDisk(path: string): Record<string, unknown> | undefined {
    const raw = fake.disk.get(path)
    return raw === undefined ? undefined : (JSON.parse(raw) as Record<string, unknown>)
}

const SAVED = {
    'recent-workspaces': ['C:\\notes', 'D:\\work'],
    'open-tabs:C:\\notes': { tabIds: ['C:\\notes\\a.md'], activeTabId: 'C:\\notes\\a.md' },
}

describe('workspace store', () => {
    beforeEach(() => {
        fake.disk.clear()
        fake.caches.clear()
        fake.saveError = null
        fake.initError = null
        vi.mocked(notifyWarning).mockClear()
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    describe('a damaged workspace.json', () => {
        it('keeps a copy each time the file is read without trouble', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            await vi.waitFor(() => expect(onDisk('workspace.backup.json')).toEqual({ snapshot: SAVED }))
            expect(notifyWarning).not.toHaveBeenCalled()
        })

        it('is filled from the copy before anything can save over it, and says so', async () => {
            fake.disk.set('workspace.json', '\0\0\0\0')
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: SAVED }))
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            expect(await store.getWorkspaceTabSession('C:\\notes')).toEqual({ tabIds: ['C:\\notes\\a.md'], activeTabId: 'C:\\notes\\a.md' })
            expect(onDisk('workspace.json')).toEqual(SAVED)
            expect(notifyWarning).toHaveBeenCalledWith('Recent folders restored', expect.objectContaining({ description: expect.any(String) }))
        })

        it('says the lists start empty when there is no copy to bring back', async () => {
            fake.disk.set('workspace.json', '')
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(notifyWarning).toHaveBeenCalledWith('Recent folders were reset', expect.anything())
        })

        it('starts quietly on a first launch, when there is no file yet', async () => {
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: SAVED }))
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(notifyWarning).not.toHaveBeenCalled()
            expect(onDisk('workspace.backup.json')).toEqual({ snapshot: SAVED })
        })

        it('reads the file once however many callers ask for it at the same time', async () => {
            fake.disk.set('workspace.json', '{"recent-workspaces": [')
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: SAVED }))
            const store = await launch()

            const [recents, files] = await Promise.all([store.getRecentWorkspaces(), store.getRecentFiles('C:\\notes')])

            expect(recents).toEqual(['C:\\notes', 'D:\\work'])
            expect(files).toEqual([])
            expect(notifyWarning).toHaveBeenCalledTimes(1)
        })
    })

    describe('entries that are not paths', () => {
        it('lists only real paths, each once, whatever else the recent folders hold', async () => {
            fake.disk.set(
                'workspace.json',
                JSON.stringify({ 'recent-workspaces': [null, 42, { path: 'x' }, '', 'C:\\notes', 'c:/Notes/', 'D:\\work'] })
            )
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
        })

        it('writes a clean list back when a folder is added or removed', async () => {
            fake.disk.set('workspace.json', JSON.stringify({ 'recent-workspaces': [null, 'C:\\notes', 7, 'D:\\work'] }))
            const store = await launch()

            expect(await store.addRecentWorkspace('c:/notes', 10)).toEqual(['c:\\notes', 'D:\\work'])
            expect(await store.removeRecentWorkspace('d:\\WORK')).toEqual(['c:\\notes'])
            expect(onDisk('workspace.json')?.['recent-workspaces']).toEqual(['c:\\notes'])
        })

        it('lists only real paths for a folder’s recent files', async () => {
            fake.disk.set(
                'workspace.json',
                JSON.stringify({ 'recent-files:C:\\notes': ['C:\\notes\\a.md', false, 'C:/notes/a.md', [], 'C:\\notes\\b.md'] })
            )
            const store = await launch()

            expect(await store.getRecentFiles('C:\\notes')).toEqual(['C:\\notes\\a.md', 'C:\\notes\\b.md'])
        })
    })

    describe('folders that leave the recent folders', () => {
        const KEPT = {
            'recent-workspaces': ['C:\\notes', 'D:\\work'],
            'open-tabs:C:\\notes': { tabIds: ['C:\\notes\\private.md'], activeTabId: 'C:\\notes\\private.md' },
            'last-file:C:\\notes': 'C:\\notes\\private.md',
            'open-folders:C:\\notes': [['C:\\notes\\private', false]],
            'recent-files:c:/Notes': ['c:/Notes/private.md'],
            'open-tabs:D:\\work': { tabIds: ['D:\\work\\plan.md'], activeTabId: 'D:\\work\\plan.md' },
            'recent-files:D:\\work': ['D:\\work\\plan.md'],
        }

        it('forgets the open tabs and file lists of a folder removed from the list', async () => {
            fake.disk.set('workspace.json', JSON.stringify(KEPT))
            const store = await launch()

            expect(await store.removeRecentWorkspace('C:\\notes')).toEqual(['D:\\work'])

            expect(onDisk('workspace.json')).toEqual({
                'recent-workspaces': ['D:\\work'],
                'open-tabs:D:\\work': KEPT['open-tabs:D:\\work'],
                'recent-files:D:\\work': KEPT['recent-files:D:\\work'],
            })
            expect(await store.getWorkspaceTabSession('C:\\notes')).toBeNull()
        })

        it('forgets them for a folder that drops off the end of the list', async () => {
            fake.disk.set('workspace.json', JSON.stringify(KEPT))
            const store = await launch()

            expect(await store.addRecentWorkspace('E:\\new', 2)).toEqual(['E:\\new', 'C:\\notes'])

            const saved = onDisk('workspace.json')!
            expect(Object.keys(saved).filter((key) => key.includes('D:\\work'))).toEqual([])
            expect(saved['recent-workspaces']).toEqual(['E:\\new', 'C:\\notes'])
            expect(saved['open-tabs:C:\\notes']).toEqual(KEPT['open-tabs:C:\\notes'])
        })
    })

    describe('folders opened and closed in the file tree', () => {
        it('remembers them for each folder, skipping entries that are not a path and open or closed', async () => {
            fake.disk.set(
                'workspace.json',
                JSON.stringify({
                    'open-folders:C:\\notes': [
                        ['C:/notes/docs', false],
                        ['C:\\notes\\deep', true],
                        'junk',
                        [3, true],
                        ['C:\\notes\\x', 'yes'],
                        ['', true],
                    ],
                })
            )
            const store = await launch()

            expect(await store.getFolderToggles('C:\\notes')).toEqual([
                ['C:\\notes\\docs', false],
                ['C:\\notes\\deep', true],
            ])
            expect(await store.getFolderToggles('D:\\work')).toEqual([])

            await store.setFolderToggles('D:\\work', new Map([['D:\\work\\plans', true]]))
            expect(onDisk('workspace.json')?.['open-folders:D:\\work']).toEqual([['D:\\work\\plans', true]])
        })

        it('keeps the latest 500 when there are more', async () => {
            const store = await launch()
            const many = new Map(Array.from({ length: 600 }, (_, i) => [`C:\\notes\\f${i}`, true] as [string, boolean]))

            await store.setFolderToggles('C:\\notes', many)

            const saved = await store.getFolderToggles('C:\\notes')
            expect(saved).toHaveLength(500)
            expect(saved[0]).toEqual(['C:\\notes\\f100', true])
        })
    })

    describe('the recent folders limit', () => {
        it('keeps as many folders as the limit it is given', async () => {
            fake.disk.set('workspace.json', JSON.stringify({ 'recent-workspaces': ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d'] }))
            const store = await launch()

            expect(await store.addRecentWorkspace('C:\\new', 3)).toEqual(['C:\\new', 'C:\\a', 'C:\\b'])
            expect(onDisk('workspace.json')?.['recent-workspaces']).toEqual(['C:\\new', 'C:\\a', 'C:\\b'])
        })

        it('keeps the limit to what the settings screen allows', async () => {
            const { clampRecentWorkspaceLimit } = await launch()

            expect(clampRecentWorkspaceLimit(0)).toBe(1)
            expect(clampRecentWorkspaceLimit(3.7)).toBe(3)
            expect(clampRecentWorkspaceLimit(500)).toBe(50)
            expect(clampRecentWorkspaceLimit(Number.NaN)).toBe(10)
        })
    })

    describe('when workspace.json cannot be written', () => {
        it('still updates the lists for this session and says so once', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.saveError = 'There is not enough space on the disk. (os error 112)'
            const store = await launch()

            await expect(store.addRecentWorkspace('E:\\new', 10)).resolves.toEqual(['E:\\new', 'C:\\notes', 'D:\\work'])
            await expect(store.setWorkspaceTabSession('E:\\new', { tabIds: [], activeTabId: null })).resolves.toBeUndefined()
            await expect(store.addRecentFile('E:\\new', 'E:\\new\\a.md')).resolves.toEqual(['E:\\new\\a.md'])

            expect(await store.getRecentWorkspaces()).toEqual(['E:\\new', 'C:\\notes', 'D:\\work'])
            expect(notifyWarning).toHaveBeenCalledTimes(1)
            expect(notifyWarning).toHaveBeenCalledWith(
                "Couldn't save recent folders",
                expect.objectContaining({ description: expect.stringContaining('There is not enough space on the disk.') })
            )
        })

        it('tries to open the store again after a failed start instead of failing for the whole session', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.initError = 'no app data folder'
            const store = await launch()

            await expect(store.getRecentWorkspaces()).rejects.toBe('no app data folder')
            fake.initError = null
            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
        })
    })
})
