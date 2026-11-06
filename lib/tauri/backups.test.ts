import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@/lib/tauri/platform'
import { deleteUnsavedBackup, listUnsavedBackups, saveUnsavedBackup, settleUnsavedBackups, type UnsavedBackup } from './backups'

const fake = vi.hoisted(() => ({
    data: new Map<string, unknown>(),
    saves: 0,
    options: undefined as unknown,
    /** When set, writing the store to disk waits for it. */
    saveGate: null as Promise<void> | null,
}))

vi.mock('@tauri-apps/plugin-store', () => ({
    LazyStore: class {
        constructor(_path: string, options?: unknown) {
            fake.options = options
        }
        async init() {}
        async set(key: string, value: unknown) {
            fake.data.set(key, structuredClone(value))
        }
        async delete(key: string) {
            return fake.data.delete(key)
        }
        async values() {
            return [...fake.data.values()]
        }
        async save() {
            if (fake.saveGate) await fake.saveGate
            fake.saves += 1
        }
    },
}))

vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn(() => true) }))

function backup(path: string, overrides: Partial<UnsavedBackup> = {}): UnsavedBackup {
    return { path, root: 'C:\\ws', content: 'unsaved', stamp: { mtimeMs: 5, size: 3 }, savedAt: 1, ...overrides }
}

describe('unsaved-change backups', () => {
    beforeEach(() => {
        fake.data.clear()
        fake.saves = 0
        vi.mocked(isTauri).mockReturnValue(true)
    })

    it('keeps one copy per file, the newest, and saves it to disk straight away', async () => {
        await saveUnsavedBackup(backup('C:\\ws\\a.md', { content: 'first' }))
        await saveUnsavedBackup(backup('c:/WS/A.md', { content: 'second', savedAt: 2 }))

        expect(await listUnsavedBackups()).toEqual([expect.objectContaining({ path: 'c:\\WS\\A.md', content: 'second' })])
        expect(fake.saves).toBe(2)
        expect(fake.options).toEqual(expect.objectContaining({ autoSave: false }))
    })

    it('lists newest first and leaves out entries it cannot read', async () => {
        await saveUnsavedBackup(backup('C:\\ws\\old.md', { savedAt: 1 }))
        await saveUnsavedBackup(backup('C:\\ws\\new.md', { savedAt: 9, format: { encoding: 'utf-16le', bom: true } }))
        fake.data.set('broken', { path: 42 })
        fake.data.set('odd', { path: 'C:/ws/odd.md', content: 'x', stamp: 'nope', format: { encoding: 'latin1' } })

        const listed = await listUnsavedBackups()

        expect(listed.map((b) => b.path)).toEqual(['C:\\ws\\new.md', 'C:\\ws\\old.md', 'C:\\ws\\odd.md'])
        expect(listed[0]!.format).toEqual({ encoding: 'utf-16le', bom: true })
        expect(listed[2]).toMatchObject({ root: null, stamp: null, format: undefined, savedAt: 0 })
    })

    it('forgets a copy once the file is saved, and only writes when there was one', async () => {
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        fake.saves = 0

        await deleteUnsavedBackup('C:/ws/a.md')
        await deleteUnsavedBackup('C:\\ws\\a.md')

        expect(await listUnsavedBackups()).toEqual([])
        expect(fake.saves).toBe(1)
    })

    it('lets closing wait until a removal has reached the disk, but never for long', async () => {
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        let openGate!: () => void
        fake.saveGate = new Promise<void>((resolve) => (openGate = resolve))
        try {
            void deleteUnsavedBackup('C:\\ws\\a.md')
            let settled = false
            const settling = settleUnsavedBackups(1000).then(() => (settled = true))
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(settled).toBe(false)
            openGate()
            await settling
            expect(fake.saves).toBe(2)

            // A store that never answers doesn't keep the window open.
            fake.saveGate = new Promise<void>(() => {})
            void saveUnsavedBackup(backup('C:\\ws\\b.md'))
            await expect(settleUnsavedBackups(10)).resolves.toBeUndefined()
        } finally {
            fake.saveGate = null
        }
    })

    it('does nothing outside the desktop app', async () => {
        vi.mocked(isTauri).mockReturnValue(false)
        await saveUnsavedBackup(backup('C:\\ws\\a.md'))
        expect(await listUnsavedBackups()).toEqual([])
        expect(fake.data.size).toBe(0)
    })
})
