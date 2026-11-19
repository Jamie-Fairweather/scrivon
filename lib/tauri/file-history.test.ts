import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
    tauri: true,
    /** The files on disk, as bytes. */
    disk: new Map<string, Uint8Array>(),
    invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => true),
}))

vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => fake.tauri }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async (path: string) => {
        const bytes = fake.disk.get(path)
        if (!bytes) throw 'The system cannot find the file specified. (os error 2)'
        return bytes
    }),
    stat: vi.fn(async (path: string) => {
        const bytes = fake.disk.get(path)
        if (!bytes) throw 'The system cannot find the file specified. (os error 2)'
        return { size: bytes.length, mtime: new Date(1000) }
    }),
}))

const { deleteAllFileHistory, isTooLargeForHistory, keepDiskVersion, listFileVersions, readFileVersion, recordFileVersion } =
    await import('./file-history')

/** `text` as UTF-16 LE with its byte order mark, as Notepad saves "Unicode". */
function utf16le(text: string): Uint8Array {
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        bytes[2 + i * 2] = unit & 0xff
        bytes[3 + i * 2] = unit >> 8
    }
    return bytes
}

beforeEach(() => {
    fake.tauri = true
    fake.disk.clear()
    fake.invoke.mockReset()
    fake.invoke.mockResolvedValue(true)
})

describe('file history outside the desktop app', () => {
    it('keeps and lists nothing, and never calls the app', async () => {
        fake.tauri = false
        fake.disk.set('C:\\w\\a.md', new TextEncoder().encode('on disk'))

        await expect(recordFileVersion('C:\\w\\a.md', 'text', 'manual')).resolves.toBe(false)
        await expect(listFileVersions('C:\\w\\a.md')).resolves.toEqual([])
        await expect(keepDiskVersion('C:\\w\\a.md', 'before-first-write')).resolves.toBe(false)
        await expect(deleteAllFileHistory()).resolves.toBeUndefined()
        await expect(readFileVersion('C:\\w\\a.md', 'a'.repeat(32))).rejects.toThrow()
        expect(fake.invoke).not.toHaveBeenCalled()
    })
})

describe('file history in the desktop app', () => {
    it('sends the text, its kind and the path in the form the app uses', async () => {
        await expect(recordFileVersion('C:/w//a.md', 'text', 'autosave')).resolves.toBe(true)
        expect(fake.invoke).toHaveBeenCalledWith('record_file_version', { path: 'C:\\w\\a.md', text: 'text', kind: 'autosave' })

        fake.invoke.mockResolvedValueOnce(false)
        await expect(recordFileVersion('C:\\w\\a.md', 'text', 'manual')).resolves.toBe(false)
    })

    it('lists, reads and deletes through the app', async () => {
        const version = { id: 'a'.repeat(32), createdMs: 1, savedMs: 2, size: 4, kind: 'manual' }
        fake.invoke.mockResolvedValueOnce([version])
        await expect(listFileVersions('C:\\w\\a.md')).resolves.toEqual([version])
        expect(fake.invoke).toHaveBeenLastCalledWith('list_file_versions', { path: 'C:\\w\\a.md' })

        fake.invoke.mockResolvedValueOnce(null)
        await expect(listFileVersions('C:\\w\\a.md')).resolves.toEqual([])

        fake.invoke.mockResolvedValueOnce('kept text')
        await expect(readFileVersion('C:\\w\\a.md', version.id)).resolves.toBe('kept text')
        expect(fake.invoke).toHaveBeenLastCalledWith('read_file_version', { path: 'C:\\w\\a.md', id: version.id })

        await deleteAllFileHistory()
        expect(fake.invoke).toHaveBeenLastCalledWith('delete_file_history')
    })

    it('passes on what the app refuses', async () => {
        fake.invoke.mockRejectedValueOnce('Scrivon can only keep the history of files in a folder you opened')
        await expect(recordFileVersion('C:\\elsewhere\\a.md', 'x', 'manual')).rejects.toMatch('folder you opened')
    })

    it('keeps no copy of text over 5 MB as UTF-8', async () => {
        const fiveMb = 5 * 1024 * 1024
        expect(isTooLargeForHistory('x'.repeat(fiveMb))).toBe(false)
        expect(isTooLargeForHistory('x'.repeat(fiveMb + 1))).toBe(true)
        // Fewer characters than bytes: each é is two bytes.
        expect(isTooLargeForHistory('é'.repeat(fiveMb / 2 + 1))).toBe(true)

        await expect(recordFileVersion('C:\\w\\a.md', 'x'.repeat(fiveMb + 1), 'manual')).resolves.toBe(false)
        expect(fake.invoke).not.toHaveBeenCalled()
    })
})

describe('keepDiskVersion', () => {
    it('keeps a UTF-16 LE file as the text it shows, not its bytes', async () => {
        fake.disk.set('C:\\w\\a.md', utf16le('Grüße 日本'))

        await expect(keepDiskVersion('C:\\w\\a.md', 'before-first-write')).resolves.toBe(true)

        expect(fake.invoke).toHaveBeenCalledWith('record_file_version', { path: 'C:\\w\\a.md', text: 'Grüße 日本', kind: 'before-first-write' })
    })

    it('keeps a Windows-1252 file as the text it shows', async () => {
        // "café – “ok”" saved by an old program as Windows-1252.
        fake.disk.set('C:\\w\\a.md', new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x93, 0x6f, 0x6b, 0x94]))

        await keepDiskVersion('C:\\w\\a.md', 'before-overwrite')

        expect(fake.invoke).toHaveBeenCalledWith('record_file_version', { path: 'C:\\w\\a.md', text: 'café – “ok”', kind: 'before-overwrite' })
    })

    it('keeps nothing for a file that is not there, is over 5 MB or is binary', async () => {
        await expect(keepDiskVersion('C:\\w\\new.md', 'before-first-write')).resolves.toBe(false)

        fake.disk.set('C:\\w\\big.md', new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61))
        await expect(keepDiskVersion('C:\\w\\big.md', 'before-first-write')).resolves.toBe(false)

        fake.disk.set('C:\\w\\image.md', new Uint8Array([0x61, 0x00, 0x62, 0x00, 0x00, 0x01]))
        await expect(keepDiskVersion('C:\\w\\image.md', 'before-first-write')).resolves.toBe(false)

        expect(fake.invoke).not.toHaveBeenCalled()
    })

    it('keeps nothing once the save stopped waiting for it, as the file may hold the new text by then', async () => {
        fake.disk.set('C:\\w\\a.md', new TextEncoder().encode('on disk'))
        const late = new AbortController()

        const keeping = keepDiskVersion('C:\\w\\a.md', 'before-first-write', late.signal)
        late.abort()

        await expect(keeping).resolves.toBe(false)
        await expect(keepDiskVersion('C:\\w\\a.md', 'before-first-write', late.signal)).resolves.toBe(false)
        expect(fake.invoke).not.toHaveBeenCalled()
    })

    it('says when the file is there but cannot be read', async () => {
        const fs = await import('@tauri-apps/plugin-fs')
        vi.mocked(fs.readFile).mockRejectedValueOnce('The process cannot access the file because it is being used by another process. (os error 32)')
        fake.disk.set('C:\\w\\a.md', new Uint8Array([0x61]))

        await expect(keepDiskVersion('C:\\w\\a.md', 'before-first-write')).rejects.toMatch('os error 32')
    })
})
