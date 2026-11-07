import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnsavedBackup } from './backups'

const MAIN = 'unsaved-changes.json'
const SECOND = 'unsaved-changes.2.json'

const fake = vi.hoisted(() => ({
    /** What each store file holds on disk: its entries, 'damaged' (can't be parsed), or nothing yet. */
    disk: new Map<string, Record<string, unknown> | 'damaged'>(),
    /** The files written, in order. */
    saves: [] as string[],
    /** When set, writing a store to disk waits for it. */
    saveGate: null as Promise<void> | null,
    /** Store files the app shell couldn't open at startup. */
    notOpened: new Set<string>(),
}))

// Only getStore: the app shell opens the store files at startup, and the webview may not open one itself.
vi.mock('@tauri-apps/plugin-store', () => {
    class FakeStore {
        private cache = new Map<string, unknown>()

        /** Like the app shell at startup: a file it can't read or parse is quietly ignored. */
        constructor(private readonly path: string) {
            const onDisk = fake.disk.get(path)
            if (onDisk && onDisk !== 'damaged') this.cache = new Map(Object.entries(structuredClone(onDisk)))
        }
        async reload() {
            const onDisk = fake.disk.get(this.path)
            if (onDisk === undefined) throw 'The system cannot find the file specified. (os error 2)'
            if (onDisk === 'damaged') throw 'EOF while parsing a value at line 1 column 0'
            this.cache = new Map(Object.entries(structuredClone(onDisk)))
        }
        async get(key: string) {
            return this.cache.get(key)
        }
        async set(key: string, value: unknown) {
            this.cache.set(key, structuredClone(value))
        }
        async delete(key: string) {
            return this.cache.delete(key)
        }
        async clear() {
            this.cache.clear()
        }
        async entries() {
            return [...this.cache.entries()]
        }
        async save() {
            if (fake.saveGate) await fake.saveGate
            fake.saves.push(this.path)
            fake.disk.set(this.path, structuredClone(Object.fromEntries(this.cache)))
        }
    }
    return { getStore: async (path: string) => (fake.notOpened.has(path) ? null : new FakeStore(path)) }
})

vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn(() => true) }))

function backup(path: string, overrides: Partial<UnsavedBackup> = {}): UnsavedBackup {
    return { path, root: 'C:\\ws', content: 'unsaved', stamp: { mtimeMs: 5, size: 3 }, savedAt: 1, ...overrides }
}

/** A fresh copy of the module, as on a new launch. */
async function launch() {
    vi.resetModules()
    const platform = await import('@/lib/tauri/platform')
    vi.mocked(platform.isTauri).mockReturnValue(true)
    return { ...(await import('./backups')), isTauri: vi.mocked(platform.isTauri) }
}

/** The copies a file holds on disk, without the write counter. */
function copiesOnDisk(path: string): string[] {
    const onDisk = fake.disk.get(path)
    if (!onDisk || onDisk === 'damaged') return []
    return Object.entries(onDisk)
        .filter(([key]) => key !== '#generation')
        .map(([, value]) => (value as UnsavedBackup).content)
}

describe('unsaved-change backups', () => {
    beforeEach(() => {
        fake.disk.clear()
        fake.saves = []
        fake.saveGate = null
        fake.notOpened.clear()
    })

    it('keeps one copy per file, the newest, and saves it to disk straight away', async () => {
        const { saveUnsavedBackup, listUnsavedBackups } = await launch()
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'first' }))
        await saveUnsavedBackup(backup('c:/WS/A.md', { content: 'second', savedAt: 2 }))

        expect(await listUnsavedBackups()).toEqual([expect.objectContaining({ path: 'c:\\WS\\A.md', content: 'second' })])
        expect(fake.saves).toHaveLength(2)
    })

    it('writes the two files in turn, so one always holds the copies from the change before', async () => {
        const { saveUnsavedBackup } = await launch()
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'one' }))
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'two' }))
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'three' }))

        expect(fake.saves).toEqual([SECOND, MAIN, SECOND])
        expect(copiesOnDisk(SECOND)).toEqual(['three'])
        expect(copiesOnDisk(MAIN)).toEqual(['two'])
    })

    it('brings the copies back from the other file when a power cut damaged one, and leaves that one alone', async () => {
        fake.disk.set(MAIN, 'damaged')
        fake.disk.set(SECOND, { '#generation': 5, 'c:\\ws\\a.md': backup('C:\\ws\\a.md', { content: 'kept' }) })
        const { saveUnsavedBackup, listUnsavedBackups } = await launch()

        expect((await listUnsavedBackups()).map((b) => b.content)).toEqual(['kept'])

        await saveUnsavedBackup(backup('C:\\ws\\b.md', { content: 'new' }))
        // The damaged file is written next, so the good one isn't touched until the other is whole again.
        expect(fake.saves).toEqual([MAIN])
        expect(copiesOnDisk(SECOND)).toEqual(['kept'])
        expect(copiesOnDisk(MAIN).sort()).toEqual(['kept', 'new'])
    })

    it('uses the newer of the two files, so a removed copy does not come back', async () => {
        fake.disk.set(MAIN, { '#generation': 3, 'c:\\ws\\a.md': backup('C:\\ws\\a.md', { content: 'old' }) })
        fake.disk.set(SECOND, { '#generation': 4, 'c:\\ws\\b.md': backup('C:\\ws\\b.md', { content: 'newer' }) })
        const { saveUnsavedBackup, listUnsavedBackups } = await launch()

        expect((await listUnsavedBackups()).map((b) => b.content)).toEqual(['newer'])
        await saveUnsavedBackup(backup('C:\\ws\\c.md'))
        expect(fake.saves).toEqual([MAIN])
    })

    it('lists newest first and leaves out entries it cannot read', async () => {
        fake.disk.set(MAIN, {
            '#generation': 1,
            broken: { path: 42 },
            odd: { path: 'C:/ws/odd.md', content: 'x', stamp: 'nope', format: { encoding: 'latin1' } },
        })
        const { saveUnsavedBackup, listUnsavedBackups } = await launch()
        await saveUnsavedBackup(backup('C:\\ws\\old.md', { savedAt: 1 }))
        await saveUnsavedBackup(backup('C:\\ws\\new.md', { savedAt: 9, format: { encoding: 'utf-16le', bom: true } }))

        const listed = await listUnsavedBackups()

        expect(listed.map((b) => b.path)).toEqual(['C:\\ws\\new.md', 'C:\\ws\\old.md', 'C:\\ws\\odd.md'])
        expect(listed[0]!.format).toEqual({ encoding: 'utf-16le', bom: true })
        expect(listed[2]).toMatchObject({ root: null, stamp: null, format: undefined, savedAt: 0 })
    })

    it('forgets a copy once the file is saved, and only writes when there was one', async () => {
        const { saveUnsavedBackup, deleteUnsavedBackup, listUnsavedBackups } = await launch()
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        fake.saves = []

        await deleteUnsavedBackup('C:/ws/a.md')
        await deleteUnsavedBackup('C:\\ws\\a.md')

        expect(await listUnsavedBackups()).toEqual([])
        expect(fake.saves).toHaveLength(1)
    })

    it('lets closing wait until a removal has reached the disk, but never for long', async () => {
        const { saveUnsavedBackup, deleteUnsavedBackup, settleUnsavedBackups } = await launch()
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        let openGate!: () => void
        fake.saveGate = new Promise<void>((resolve) => (openGate = resolve))
        void deleteUnsavedBackup('C:\\ws\\a.md')
        let settled = false
        const settling = settleUnsavedBackups(1000).then(() => (settled = true))
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(settled).toBe(false)
        openGate()
        await settling
        expect(fake.saves).toHaveLength(2)

        // A store that never answers doesn't keep the window open.
        fake.saveGate = new Promise<void>(() => {})
        void saveUnsavedBackup(backup('C:\\ws\\b.md'))
        await expect(settleUnsavedBackups(10)).resolves.toBeUndefined()
    })

    it('reports a file the app did not open at startup, and tries again next time', async () => {
        fake.notOpened.add(SECOND)
        const { saveUnsavedBackup, listUnsavedBackups } = await launch()

        await expect(saveUnsavedBackup(backup('C:\\ws\\a.md'))).rejects.toThrow("Scrivon couldn't open unsaved-changes.2.json.")
        expect(fake.saves).toEqual([])

        fake.notOpened.clear()
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'kept' }))
        expect((await listUnsavedBackups()).map((b) => b.content)).toEqual(['kept'])
    })

    it('does nothing outside the desktop app', async () => {
        const { saveUnsavedBackup, listUnsavedBackups, isTauri } = await launch()
        isTauri.mockReturnValue(false)
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        expect(await listUnsavedBackups()).toEqual([])
        expect(fake.disk.size).toBe(0)
    })
})
