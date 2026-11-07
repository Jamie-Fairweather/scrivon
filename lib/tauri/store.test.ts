import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyWarning } from '@/lib/notify'

/**
 * A stand-in for tauri-plugin-store that behaves like the real one: `disk` holds each file's text. The app
 * shell opens each store once at startup, loading its file and quietly starting empty when it can't, and the
 * webview can only get those (there is no `load` here, so the module must never try to open one itself).
 * reload() reports why a file couldn't be read, and save() writes the whole store back. workspace.json also saves
 * itself soon after any change, as the app shell sets it up to; `runAutoSave` does that here. Every store still
 * open is saved as the app quits (`quitApp`). A store the webview closes is gone from the app shell for the run.
 */
const fake = vi.hoisted(() => ({
    disk: new Map<string, string>(),
    /** The stores the app shell holds in memory. They outlive a reload of the window. */
    caches: new Map<string, Map<string, unknown>>(),
    /** Store files the app shell couldn't open at startup. */
    notOpened: new Set<string>(),
    saveError: null as unknown,
    openError: null as unknown,
    /** The name the app shell gave a damaged workspace.json it moved aside at startup (take_store_recovery). */
    keptAs: null as string | null,
    /** Files another program holds, or that are on a drive that is offline: reading or saving them fails this many times. */
    held: new Map<string, { error: string; times: number }>(),
    /** Stores changed since they were last saved, which the store plugin saves by itself soon after. */
    autoSavePending: new Set<string>(),
    /** Stores the webview closed: the app shell no longer has them, until the app starts again. */
    closed: new Set<string>(),
}))

/** Fails while another program holds the file, counting the try. */
function checkNotHeld(path: string): void {
    const held = fake.held.get(path)
    if (!held || held.times <= 0) return
    held.times--
    throw held.error
}

function parseStoreFile(path: string): Record<string, unknown> {
    checkNotHeld(path)
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

vi.mock('@tauri-apps/plugin-store', () => {
    class FakeStore {
        constructor(private readonly path: string) {}
        private get cache(): Map<string, unknown> {
            if (fake.closed.has(this.path)) throw `The store ${this.path} was closed.`
            return fake.caches.get(this.path)!
        }
        async reload() {
            for (const [key, value] of Object.entries(parseStoreFile(this.path))) this.cache.set(key, value)
        }
        async get(key: string) {
            return this.cache.has(key) ? structuredClone(this.cache.get(key)) : undefined
        }
        /** workspace.json saves itself soon after a change (src-tauri/src/lib.rs); the others are saved by hand. */
        private changed() {
            if (this.path === 'workspace.json') fake.autoSavePending.add(this.path)
        }
        async set(key: string, value: unknown) {
            this.cache.set(key, structuredClone(value))
            this.changed()
        }
        async delete(key: string) {
            this.changed()
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
        async clear() {
            this.cache.clear()
            this.changed()
        }
        async save() {
            if (fake.saveError) throw fake.saveError
            checkNotHeld(this.path)
            fake.autoSavePending.delete(this.path)
            fake.disk.set(this.path, JSON.stringify(Object.fromEntries(this.cache)))
        }
        async close() {
            fake.closed.add(this.path)
            fake.autoSavePending.delete(this.path)
        }
    }
    return {
        getStore: async (path: string) => {
            if (fake.openError) throw fake.openError
            if (fake.notOpened.has(path) || fake.closed.has(path)) return null
            if (!fake.caches.has(path)) {
                const cache = new Map<string, unknown>()
                try {
                    for (const [key, value] of Object.entries(parseStoreFile(path))) cache.set(key, value)
                } catch {
                    // The real plugin ignores this too.
                }
                fake.caches.set(path, cache)
            }
            return new FakeStore(path)
        },
    }
})

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (command: string) => {
        if (command !== 'take_store_recovery') throw new Error(`unexpected command ${command}`)
        const name = fake.keptAs
        fake.keptAs = null
        return name
    }),
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

/**
 * The store plugin's save, as the app quits, of every store it still has open (its RunEvent::Exit handler): the
 * whole store is written, changed or not. The next launch starts with nothing in memory.
 */
function quitApp(): void {
    for (const [path, cache] of fake.caches) {
        if (!fake.closed.has(path) && !fake.held.get(path)?.times) fake.disk.set(path, JSON.stringify(Object.fromEntries(cache)))
    }
    fake.caches.clear()
    fake.closed.clear()
    fake.autoSavePending.clear()
}

/** The store plugin's own save soon after a change, which the module can't stop once it is due. */
function runAutoSave(): void {
    for (const path of fake.autoSavePending) {
        fake.autoSavePending.delete(path)
        if (!fake.held.get(path)?.times) fake.disk.set(path, JSON.stringify(Object.fromEntries(fake.caches.get(path)!)))
    }
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
        fake.notOpened.clear()
        fake.saveError = null
        fake.openError = null
        fake.keptAs = null
        fake.held.clear()
        fake.autoSavePending.clear()
        fake.closed.clear()
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

        it('is filled from the copy when the app shell kept it aside, and says where it went', async () => {
            // The app shell moved the damaged file away before the store opened, so it reads as missing.
            fake.keptAs = 'workspace.json.corrupt-1731000000'
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: SAVED }))
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            expect(onDisk('workspace.json')).toEqual(SAVED)
            expect(notifyWarning).toHaveBeenCalledTimes(1)
            expect(notifyWarning).toHaveBeenCalledWith(
                'Recent folders restored',
                expect.objectContaining({ description: expect.stringContaining('kept as workspace.json.corrupt-1731000000') })
            )

            // The name is handed out once: the next launch reads the restored file without a word.
            vi.mocked(notifyWarning).mockClear()
            fake.caches.clear()
            expect(await (await launch()).getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            expect(notifyWarning).not.toHaveBeenCalled()
        })

        it('says the lists start empty and where the damaged file went when there is no copy', async () => {
            fake.keptAs = 'workspace.json.corrupt-1731000000'
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(notifyWarning).toHaveBeenCalledWith(
                'Recent folders were reset',
                expect.objectContaining({ description: expect.stringContaining('kept as workspace.json.corrupt-1731000000') })
            )
        })

        it('starts quietly when it cannot ask whether the file was kept aside', async () => {
            const { invoke } = await import('@tauri-apps/api/core')
            vi.mocked(invoke).mockRejectedValueOnce(new Error('no such command'))
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: SAVED }))
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(notifyWarning).not.toHaveBeenCalled()
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

    describe('a workspace.json that cannot be read just now', () => {
        const IN_USE = 'The process cannot access the file because it is being used by another process. (os error 32)'
        const OFFLINE = 'The network name cannot be found. (os error 67)'
        const OLDER = { 'recent-workspaces': ['C:\\old'] }

        it('reads a file another program held for a moment', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            // The app shell's read at startup, then the first two of the module's.
            fake.held.set('workspace.json', { error: IN_USE, times: 3 })
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            expect(notifyWarning).not.toHaveBeenCalled()
            await vi.waitFor(() => expect(onDisk('workspace.backup.json')).toEqual({ snapshot: SAVED }))
        })

        it('leaves the file alone instead of putting the older copy or an empty list over it', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.disk.set('workspace.backup.json', JSON.stringify({ snapshot: OLDER }))
            fake.held.set('workspace.json', { error: IN_USE, times: Number.POSITIVE_INFINITY })
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            await store.addRecentWorkspace('E:\\new', 10)
            await store.setWorkspaceTabSession('E:\\new', { tabIds: ['E:\\new\\a.md'], activeTabId: 'E:\\new\\a.md' })
            await store.setFolderToggles('E:\\new', new Map([['E:\\new\\docs', true]]))
            await store.addRecentFile('E:\\new', 'E:\\new\\a.md')
            await store.removeRecentWorkspace('C:\\notes')

            // The other program lets go, and the store plugin's own save after a change would run.
            fake.held.clear()
            runAutoSave()
            expect(onDisk('workspace.json')).toEqual(SAVED)
            expect(onDisk('workspace.backup.json')).toEqual({ snapshot: OLDER })
            expect(notifyWarning).toHaveBeenCalledTimes(1)
            expect(notifyWarning).toHaveBeenCalledWith(
                "Couldn't read recent folders",
                expect.objectContaining({ description: expect.stringContaining('(os error 32)') })
            )

            // Nor does the store plugin's save of every store as the app quits.
            quitApp()
            expect(onDisk('workspace.json')).toEqual(SAVED)
            // The next launch reads it as usual.
            expect(await (await launch()).getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            await vi.waitFor(() => expect(onDisk('workspace.backup.json')).toEqual({ snapshot: SAVED }))
        })

        it('leaves the file alone for the rest of the run, even once it can be written again', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.held.set('workspace.json', { error: OFFLINE, times: Number.POSITIVE_INFINITY })
            const store = await launch()
            expect(await store.getRecentWorkspaces()).toEqual([])

            // The network drive is back, but what this run holds didn't come from the file.
            fake.held.clear()
            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(await store.addRecentWorkspace('E:\\new', 10)).toEqual([])
            // The window is reloaded: still nothing to save over the file.
            const reloaded = await launch()
            expect(await reloaded.getWorkspaceTabSession('C:\\notes')).toBeNull()
            await reloaded.setWorkspaceTabSession('C:\\notes', { tabIds: [], activeTabId: null })
            quitApp()

            expect(onDisk('workspace.json')).toEqual(SAVED)
        })

        it('does not wait to try again when the drive is offline', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            const held = { error: OFFLINE, times: 100 }
            fake.held.set('workspace.json', held)
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(await store.getRecentFiles('C:\\notes')).toEqual([])
            // Once by the app shell and once by the module: no quick tries again.
            expect(100 - held.times).toBe(2)
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

    describe('recent files after a rename or delete', () => {
        const RECENT = ['C:\\notes\\a.md', 'C:\\notes\\docs\\b.md', 'C:\\notes\\docs\\deep\\c.md', 'C:\\notes\\docs.md']

        async function launchWithRecent(paths: unknown[] = RECENT) {
            fake.disk.set('workspace.json', JSON.stringify({ 'recent-files:C:\\notes': paths }))
            return launch()
        }

        it('moves a renamed file to its new path, in the same place in the list', async () => {
            const store = await launchWithRecent()

            expect(await store.renameRecentFiles('C:\\notes', 'C:\\notes\\docs\\b.md', 'C:\\notes\\docs\\ideas.md')).toEqual([
                'C:\\notes\\a.md',
                'C:\\notes\\docs\\ideas.md',
                'C:\\notes\\docs\\deep\\c.md',
                'C:\\notes\\docs.md',
            ])
            expect(onDisk('workspace.json')?.['recent-files:C:\\notes']).toEqual(await store.getRecentFiles('C:\\notes'))
        })

        it('moves every file inside a renamed folder, and only those', async () => {
            const store = await launchWithRecent()

            await store.renameRecentFiles('C:\\notes', 'C:\\notes\\docs', 'C:\\notes\\manual')

            expect(await store.getRecentFiles('C:\\notes')).toEqual([
                'C:\\notes\\a.md',
                'C:\\notes\\manual\\b.md',
                'C:\\notes\\manual\\deep\\c.md',
                'C:\\notes\\docs.md',
            ])
        })

        it('matches Windows paths whatever their case or separators', async () => {
            const store = await launchWithRecent(['c:/Notes/Docs/B.md', 'C:\\notes\\a.md'])

            await store.renameRecentFiles('C:\\notes', 'C:\\NOTES\\docs', 'C:\\notes\\manual')
            expect(await store.getRecentFiles('C:\\notes')).toEqual(['C:\\notes\\manual\\B.md', 'C:\\notes\\a.md'])

            await store.removeRecentFiles('C:\\notes', 'c:/notes/A.MD')
            expect(await store.getRecentFiles('C:\\notes')).toEqual(['C:\\notes\\manual\\B.md'])
        })

        it('drops a deleted file, or every file inside a deleted folder', async () => {
            const store = await launchWithRecent()

            expect(await store.removeRecentFiles('C:\\notes', 'C:\\notes\\a.md')).toEqual([
                'C:\\notes\\docs\\b.md',
                'C:\\notes\\docs\\deep\\c.md',
                'C:\\notes\\docs.md',
            ])
            expect(await store.removeRecentFiles('C:\\notes', 'C:\\notes\\docs')).toEqual(['C:\\notes\\docs.md'])
            expect(onDisk('workspace.json')?.['recent-files:C:\\notes']).toEqual(['C:\\notes\\docs.md'])
        })

        it('writes nothing when no recent file was affected', async () => {
            const stored = [null, 'C:\\notes\\a.md']
            const store = await launchWithRecent(stored)

            await store.renameRecentFiles('C:\\notes', 'C:\\notes\\other.md', 'C:\\notes\\x.md')
            await store.removeRecentFiles('C:\\notes', 'C:\\notes\\gone')

            expect(onDisk('workspace.json')?.['recent-files:C:\\notes']).toEqual(stored)
        })
    })

    describe('resetting from a crash screen', () => {
        it('empties workspace.json on disk, and leaves the copies of unsaved edits alone', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.disk.set('unsaved-changes.json', JSON.stringify({ 'C:\\notes\\a.md': 'draft' }))
            const store = await launch()

            await store.clearWorkspaceStore()

            expect(onDisk('workspace.json')).toEqual({})
            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(onDisk('unsaved-changes.json')).toEqual({ 'C:\\notes\\a.md': 'draft' })
        })

        it('lets the caller say why when the file cannot be written', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            const store = await launch()
            fake.saveError = 'There is not enough space on the disk. (os error 112)'

            await expect(store.clearWorkspaceStore()).rejects.toBe('There is not enough space on the disk. (os error 112)')
            expect(notifyWarning).not.toHaveBeenCalled()
        })

        it('leaves a file it could not read alone, and says why', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.held.set('workspace.json', { error: 'Access is denied. (os error 5)', times: Number.POSITIVE_INFINITY })
            const store = await launch()

            await expect(store.clearWorkspaceStore()).rejects.toThrow("Scrivon couldn't read them when it started, so it left them as they are.")
            fake.held.clear()
            quitApp()
            expect(onDisk('workspace.json')).toEqual(SAVED)
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
            fake.openError = 'no app data folder'
            const store = await launch()

            await expect(store.getRecentWorkspaces()).rejects.toBe('no app data folder')
            fake.openError = null
            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
        })

        it('gets by without a store the app did not open at startup, and says so once', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.notOpened.add('workspace.json')
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual([])
            expect(await store.getWorkspaceTabSession('C:\\notes')).toBeNull()
            expect(await store.addRecentWorkspace('E:\\new', 10)).toEqual([])
            expect(onDisk('workspace.json')).toEqual(SAVED)
            expect(notifyWarning).toHaveBeenCalledTimes(1)
            expect(notifyWarning).toHaveBeenCalledWith(
                "Couldn't read recent folders",
                expect.objectContaining({ description: expect.stringContaining("Scrivon couldn't open workspace.json.") })
            )
        })

        it('still reads workspace.json when its copy was not opened', async () => {
            fake.disk.set('workspace.json', JSON.stringify(SAVED))
            fake.notOpened.add('workspace.backup.json')
            const store = await launch()

            expect(await store.getRecentWorkspaces()).toEqual(['C:\\notes', 'D:\\work'])
            await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith("Couldn't update the copy of workspace.json", expect.any(Error)))
            expect(notifyWarning).not.toHaveBeenCalled()
        })
    })
})
