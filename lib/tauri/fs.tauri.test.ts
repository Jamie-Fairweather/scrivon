import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
    isTauriMock,
    readDirMock,
    readFileMock,
    readTextFileMock,
    writeFileMock,
    writeTextFileMock,
    mkdirMock,
    renameMock,
    removeMock,
    copyFileMock,
    statMock,
    lstatMock,
    existsMock,
    watchMock,
    invokeMock,
} = vi.hoisted(() => ({
    isTauriMock: vi.fn(),
    readDirMock: vi.fn(),
    readFileMock: vi.fn(),
    readTextFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    writeTextFileMock: vi.fn(),
    mkdirMock: vi.fn(),
    renameMock: vi.fn(),
    removeMock: vi.fn(),
    copyFileMock: vi.fn(),
    statMock: vi.fn(),
    lstatMock: vi.fn(),
    existsMock: vi.fn(),
    watchMock: vi.fn(),
    invokeMock: vi.fn(),
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: isTauriMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: readDirMock,
    readFile: readFileMock,
    readTextFile: readTextFileMock,
    writeFile: writeFileMock,
    writeTextFile: writeTextFileMock,
    mkdir: mkdirMock,
    rename: renameMock,
    remove: removeMock,
    copyFile: copyFileMock,
    stat: statMock,
    lstat: lstatMock,
    exists: existsMock,
    watchImmediate: watchMock,
}))

import {
    classifyWatchEvent,
    createWorkspaceDirectory,
    createWorkspaceFile,
    DiskChangedError,
    duplicateWorkspaceFile,
    findHiddenFolders,
    getWorkspaceFileSize,
    isFileMissingError,
    joinPath,
    listFolderNames,
    listWorkspaceTree,
    PathExistsError,
    readWorkspaceFile,
    readWorkspaceTextFile,
    removeWorkspacePath,
    renameWorkspacePath,
    stampChanged,
    watchWorkspace,
    writeWorkspaceFile,
} from './fs'
import { isTreeTruncated } from '@/lib/workspace/paths'

describe('workspace fs (Tauri)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
        existsMock.mockResolvedValue(false)
        lstatMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 1, mtime: null, nlink: null })
        renameMock.mockResolvedValue(undefined)
        invokeMock.mockResolvedValue(undefined)
    })

    /** What the last save asked the app's save command to write, and where (see saveRequestBody). */
    function lastSave() {
        const call = invokeMock.mock.calls.findLast(([command]) => command === 'save_workspace_file')
        if (!call) return undefined
        const body = call[1] as Uint8Array
        const length = new DataView(body.buffer, body.byteOffset).getUint32(0, true)
        return { path: new TextDecoder().decode(body.subarray(4, 4 + length)), bytes: body.slice(4 + length) }
    }

    it('reads workspace files through Tauri', async () => {
        readFileMock.mockResolvedValue(new TextEncoder().encode('graph TD\n  A --> B'))
        await expect(readWorkspaceFile('/ws/diagram.mmd')).resolves.toBe('graph TD\n  A --> B')
        expect(readFileMock).toHaveBeenCalledWith('/ws/diagram.mmd')
        // Only reading the text: no second round trip for when the file last changed.
        expect(statMock).not.toHaveBeenCalled()
    })

    it('saves through the app, which replaces the file in one step, as UTF-8 by default', async () => {
        await writeWorkspaceFile('/ws/diagram.mmd', 'updated é')
        expect(lastSave()).toEqual({ path: '/ws/diagram.mmd', bytes: new TextEncoder().encode('updated é') })
        // Sent as raw bytes, not a JSON list of numbers.
        expect(invokeMock.mock.calls[0]![1]).toBeInstanceOf(Uint8Array)
        expect(writeFileMock).not.toHaveBeenCalled()
        expect(renameMock).not.toHaveBeenCalled()
    })

    it('sends a path with any letters in it, in the one form the app uses', async () => {
        await writeWorkspaceFile('C:/Users/zoë/笔记/notes.md', 'x')
        expect(lastSave()?.path).toBe('C:\\Users\\zoë\\笔记\\notes.md')
    })

    it('leaves the old file alone when it cannot be replaced (a drive gone, a full disk)', async () => {
        invokeMock.mockRejectedValue('The specified network name is no longer available. (os error 64)')
        await expect(writeWorkspaceFile('C:\\ws\\notes.md', 'new')).rejects.toBe('The specified network name is no longer available. (os error 64)')
        invokeMock.mockRejectedValue('There is not enough space on the disk. (os error 112)')
        await expect(writeWorkspaceFile('C:\\ws\\notes.md', 'new')).rejects.toBe('There is not enough space on the disk. (os error 112)')
        // Nothing was ever written to the real file.
        expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('writes in place when another program keeps the file from being replaced', async () => {
        invokeMock.mockRejectedValue('The process cannot access the file because it is being used by another process. (os error 32)')
        await writeWorkspaceFile('C:\\ws\\notes.md', 'new')
        expect(writeFileMock).toHaveBeenCalledExactlyOnceWith('C:\\ws\\notes.md', new TextEncoder().encode('new'))

        // What replacing a file another program has open can also fail with.
        invokeMock.mockRejectedValue('Unable to remove the file to be replaced. (os error 1175)')
        await writeWorkspaceFile('C:\\ws\\notes.md', 'newer')
        expect(writeFileMock).toHaveBeenLastCalledWith('C:\\ws\\notes.md', new TextEncoder().encode('newer'))
    })

    it('writes in place when it may change the file but not add one next to it', async () => {
        invokeMock.mockRejectedValueOnce('Permission denied (os error 13)')
        await writeWorkspaceFile('/ws/shared.md', 'new')
        expect(writeFileMock).toHaveBeenLastCalledWith('/ws/shared.md', new TextEncoder().encode('new'))
    })

    it('still fails, without touching the file, when there is nothing there to write into', async () => {
        lstatMock.mockRejectedValue('The system cannot find the file specified. (os error 2)')
        invokeMock.mockRejectedValueOnce('Access is denied. (os error 5)')
        await expect(writeWorkspaceFile('C:\\ws\\new.md', 'new')).rejects.toBe('Access is denied. (os error 5)')
        expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('writes a hidden or system file in place, so it keeps those marks', async () => {
        lstatMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 1, mtime: null, nlink: null, fileAttributes: 0x22 })
        await writeWorkspaceFile('C:\\ws\\.notes.md', 'text')
        expect(writeFileMock).toHaveBeenCalledWith('C:\\ws\\.notes.md', new TextEncoder().encode('text'))
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('writes through a link instead of replacing it with a plain file', async () => {
        lstatMock.mockResolvedValue({ isFile: false, isDirectory: false, isSymlink: true, size: 1, mtime: null, nlink: null })
        statMock.mockResolvedValue({ size: 4, mtime: null })
        await writeWorkspaceFile('/ws/linked.md', 'text')
        expect(writeFileMock).toHaveBeenCalledWith('/ws/linked.md', new TextEncoder().encode('text'))
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('saves a UTF-16 file with a byte-order mark the way it was read', async () => {
        // "# Café" as Windows PowerShell 5.1 writes it.
        const original = new Uint8Array([0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00])
        readFileMock.mockResolvedValue(original)
        const file = await readWorkspaceTextFile('C:\\ws\\notes.md')
        expect(file).toMatchObject({ content: '# Café', format: { encoding: 'utf-16le', bom: true } })

        await writeWorkspaceFile('C:\\ws\\notes.md', file.content, { format: file.format })
        expect(lastSave()).toEqual({ bytes: original, path: 'C:\\ws\\notes.md' })
    })

    it('notes when and how big a file was when it was read, and after it is saved', async () => {
        statMock.mockResolvedValueOnce({ size: 4, mtime: new Date(1000) }).mockResolvedValueOnce({ size: 6, mtime: new Date(2000) })
        readFileMock.mockResolvedValue(new TextEncoder().encode('text'))

        const file = await readWorkspaceTextFile('/ws/a.md')
        expect(file.stamp).toEqual({ mtimeMs: 1000, size: 4 })

        lstatMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 4, mtime: new Date(1000), nlink: null })
        await expect(writeWorkspaceFile('/ws/a.md', 'text!!', { expected: file.stamp })).resolves.toEqual({ mtimeMs: 2000, size: 6 })
    })

    it('refuses to save over a file changed outside the app since it was read', async () => {
        lstatMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 9, mtime: new Date(5000), nlink: null })

        const save = writeWorkspaceFile('/ws/a.md', 'mine', { expected: { mtimeMs: 1000, size: 4 } })
        await expect(save).rejects.toBeInstanceOf(DiskChangedError)
        await expect(save).rejects.toMatchObject({ change: 'changed', message: 'It was changed outside Scrivon since you opened it.' })
        // Only the time changed (same size) still counts as a change.
        await expect(writeWorkspaceFile('/ws/a.md', 'mine', { expected: { mtimeMs: 1000, size: 9 } })).rejects.toMatchObject({ change: 'changed' })
        expect(writeFileMock).not.toHaveBeenCalled()
        expect(invokeMock).not.toHaveBeenCalled()
    })

    it('refuses to bring back a file deleted outside the app, unless saved without a check', async () => {
        lstatMock.mockRejectedValue('The system cannot find the file specified. (os error 2)')
        existsMock.mockResolvedValue(false)

        await expect(writeWorkspaceFile('/ws/gone.md', 'mine', { expected: null })).rejects.toMatchObject({ change: 'deleted' })
        expect(invokeMock).not.toHaveBeenCalled()

        await writeWorkspaceFile('/ws/gone.md', 'mine')
        expect(lastSave()?.path).toBe('/ws/gone.md')
    })

    it('treats an unknown time as unchanged when the size matches', () => {
        expect(stampChanged({ mtimeMs: null, size: 4 }, { mtimeMs: 2000, size: 4 })).toBe(false)
        expect(stampChanged({ mtimeMs: 1000, size: 4 }, { mtimeMs: 1000, size: 4 })).toBe(false)
        expect(stampChanged({ mtimeMs: null, size: 4 }, { mtimeMs: null, size: 5 })).toBe(true)
    })

    it('keeps the byte-order mark of a UTF-8 file and flags an ANSI file', async () => {
        const withMark = new Uint8Array([0xef, 0xbb, 0xbf, 0x41])
        readFileMock.mockResolvedValueOnce(withMark)
        const file = await readWorkspaceTextFile('/ws/a.md')
        await writeWorkspaceFile('/ws/a.md', file.content, { format: file.format })
        expect(lastSave()).toMatchObject({ bytes: withMark, path: '/ws/a.md' })

        readFileMock.mockResolvedValueOnce(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
        await expect(readWorkspaceTextFile('/ws/ansi.md')).resolves.toMatchObject({ content: 'Café', issue: 'legacy-encoding' })
    })

    it('creates directories and files without replacing anything', async () => {
        await createWorkspaceDirectory('/ws/docs')
        await createWorkspaceFile('/ws/docs/readme.md', '# Hello')
        expect(mkdirMock).toHaveBeenCalledWith('/ws/docs')
        expect(writeTextFileMock).toHaveBeenCalledWith('/ws/docs/readme.md', '# Hello', { createNew: true })
    })

    it('refuses to create a file or folder over one that already exists', async () => {
        existsMock.mockResolvedValue(true)
        await expect(createWorkspaceFile('C:\\ws\\diagram.mmd', 'graph TD')).rejects.toBeInstanceOf(PathExistsError)
        await expect(createWorkspaceDirectory('C:\\ws\\docs')).rejects.toThrow('A file or folder named "docs" already exists here.')
        expect(writeTextFileMock).not.toHaveBeenCalled()
        expect(mkdirMock).not.toHaveBeenCalled()
    })

    it('renames, removes, and duplicates paths', async () => {
        const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00])
        readFileMock.mockResolvedValue(bytes)
        statMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: bytes.length, mtime: null })
        await renameWorkspacePath('/ws/old.mmd', '/ws/new.mmd')
        await removeWorkspacePath('/ws/new.mmd')
        await duplicateWorkspaceFile('/ws/source.mmd', '/ws/copy.mmd')
        expect(renameMock).toHaveBeenCalledWith('/ws/old.mmd', '/ws/new.mmd')
        expect(removeMock).toHaveBeenCalledWith('/ws/new.mmd', { recursive: false })
        // A byte-for-byte copy that refuses to replace an existing file (copyFile would replace it).
        expect(readFileMock).toHaveBeenCalledWith('/ws/source.mmd')
        expect(writeFileMock).toHaveBeenCalledWith('/ws/copy.mmd', bytes, { createNew: true })
        expect(copyFileMock).not.toHaveBeenCalled()
    })

    it('deletes a folder with everything in it only when asked to', async () => {
        await removeWorkspacePath('C:\\ws\\docs', { recursive: true })
        expect(removeMock).toHaveBeenCalledWith('C:\\ws\\docs', { recursive: true })
    })

    it('duplicates unsaved text when given, and never over an existing file', async () => {
        await duplicateWorkspaceFile('/ws/source.mmd', '/ws/copy.mmd', { content: 'UNSAVED' })
        expect(writeFileMock).toHaveBeenCalledWith('/ws/copy.mmd', new TextEncoder().encode('UNSAVED'), { createNew: true })
        expect(readFileMock).not.toHaveBeenCalled()
        writeFileMock.mockClear()

        existsMock.mockResolvedValue(true)
        await expect(duplicateWorkspaceFile('/ws/source.mmd', '/ws/taken.mmd')).rejects.toBeInstanceOf(PathExistsError)
        expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('stores duplicated unsaved text the way the file is stored', async () => {
        await duplicateWorkspaceFile('C:\\ws\\notes.md', 'C:\\ws\\notes copy.md', { content: 'A', format: { encoding: 'utf-16le', bom: true } })
        expect(writeFileMock).toHaveBeenCalledWith('C:\\ws\\notes copy.md', new Uint8Array([0xff, 0xfe, 0x41, 0x00]), { createNew: true })
    })

    it('lets the disk copy a very large file instead of reading it into the app', async () => {
        statMock.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 4 * 1024 ** 3, mtime: null })
        await duplicateWorkspaceFile('C:\\ws\\film.mp4', 'C:\\ws\\film copy.mp4')
        expect(copyFileMock).toHaveBeenCalledWith('C:\\ws\\film.mp4', 'C:\\ws\\film copy.mp4')
        expect(readFileMock).not.toHaveBeenCalled()

        existsMock.mockResolvedValue(true)
        await expect(duplicateWorkspaceFile('C:\\ws\\film.mp4', 'C:\\ws\\film copy.mp4')).rejects.toBeInstanceOf(PathExistsError)
        expect(copyFileMock).toHaveBeenCalledTimes(1)
    })

    it('lists the names in a folder straight from disk', async () => {
        readDirMock.mockResolvedValue([
            { name: 'a.md', isDirectory: false, isFile: true, isSymlink: false },
            { name: 'sub', isDirectory: true, isFile: false, isSymlink: false },
        ])
        await expect(listFolderNames('/ws')).resolves.toEqual(['a.md', 'sub'])
    })

    it('refuses to rename onto a file or folder that already exists', async () => {
        existsMock.mockResolvedValue(true)
        await expect(renameWorkspacePath('C:\\ws\\draft.md', 'C:\\ws\\final.md')).rejects.toBeInstanceOf(PathExistsError)
        expect(existsMock).toHaveBeenCalledWith('C:\\ws\\final.md')
        expect(renameMock).not.toHaveBeenCalled()
    })

    it('lets a change of letter case through, even though Windows says the new name exists', async () => {
        existsMock.mockResolvedValue(true)
        readDirMock.mockResolvedValue([{ name: 'notes.md', isDirectory: false, isFile: true, isSymlink: false }])
        await renameWorkspacePath('C:\\ws\\notes.md', 'C:\\ws\\Notes.md')
        expect(renameMock).toHaveBeenCalledWith('C:\\ws\\notes.md', 'C:\\ws\\Notes.md')
    })

    it('refuses a change of letter case when another entry has exactly that name (Linux)', async () => {
        readDirMock.mockResolvedValue([
            { name: 'notes.md', isDirectory: false, isFile: true, isSymlink: false },
            { name: 'Notes.md', isDirectory: false, isFile: true, isSymlink: false },
        ])
        await expect(renameWorkspacePath('/ws/notes.md', '/ws/Notes.md')).rejects.toBeInstanceOf(PathExistsError)
        await renameWorkspacePath('/ws/notes.md', '/ws/notes.md')
        expect(renameMock).not.toHaveBeenCalled()
    })

    it('builds a sorted workspace tree and skips ignored directories', async () => {
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === '/ws') {
                return [
                    { name: 'node_modules', isDirectory: true, isFile: false, isSymlink: false },
                    { name: 'broken-link', isDirectory: false, isFile: false, isSymlink: true },
                    { name: 'b.mmd', isDirectory: false, isFile: true, isSymlink: false },
                    { name: '.scrivon-save-k3j9x2.tmp', isDirectory: false, isFile: true, isSymlink: false },
                    { name: 'docs', isDirectory: true, isFile: false, isSymlink: false },
                ]
            }
            if (dirPath === '/ws/docs') {
                return [{ name: 'a.md', isDirectory: false, isFile: true, isSymlink: false }]
            }
            return []
        })
        statMock.mockRejectedValue('The system cannot find the file specified. (os error 2)')

        const tree = await listWorkspaceTree('/ws')
        expect(tree.map((node) => node.name)).toEqual(['docs', 'b.mmd'])
        expect(tree[0]).toMatchObject({ kind: 'directory', name: 'docs' })
        expect(tree[0]?.kind === 'directory' && tree[0].children[0]?.name).toBe('a.md')
        expect(readDirMock).not.toHaveBeenCalledWith('/ws/node_modules')
    })

    it('keeps reading the folder when one subfolder cannot be read, and skips Windows system folders', async () => {
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'D:\\') {
                return [
                    { name: 'System Volume Information', isDirectory: true, isFile: false, isSymlink: false },
                    { name: '$RECYCLE.BIN', isDirectory: true, isFile: false, isSymlink: false },
                    { name: 'locked', isDirectory: true, isFile: false, isSymlink: false },
                    { name: 'notes', isDirectory: true, isFile: false, isSymlink: false },
                ]
            }
            if (dirPath === 'D:\\locked') throw 'failed to read directory at path: D:\\locked with error: Access is denied. (os error 5)'
            if (dirPath === 'D:\\notes') return [{ name: 'a.md', isDirectory: false, isFile: true, isSymlink: false }]
            throw new Error(`unexpected read of ${dirPath}`)
        })

        const tree = await listWorkspaceTree('D:\\')
        expect(tree).toEqual([
            { kind: 'directory', name: 'locked', path: 'D:\\locked', children: [], unreadable: true },
            { kind: 'directory', name: 'notes', path: 'D:\\notes', children: [{ kind: 'file', name: 'a.md', path: 'D:\\notes\\a.md' }] },
        ])
        expect(readDirMock).not.toHaveBeenCalledWith('D:\\System Volume Information')
        expect(readDirMock).not.toHaveBeenCalledWith('D:\\$RECYCLE.BIN')
    })

    it('stops going deeper once it has listed as many entries as it may, and marks the folders left unread', async () => {
        const dir = (name: string) => ({ name, isDirectory: true, isFile: false, isSymlink: false })
        const file = (name: string) => ({ name, isDirectory: false, isFile: true, isSymlink: false })
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === '/drive') return [dir('a'), dir('b'), file('top.md')]
            if (dirPath === '/drive/a') return [dir('deep'), file('1.md'), file('2.md')]
            if (dirPath === '/drive/b') return [file('3.md')]
            return [file('never.md')]
        })

        const tree = await listWorkspaceTree('/drive', { maxEntries: 6 })

        // 3 + 3 + 1 entries listed: the budget of 6 is gone before a/deep's turn.
        expect(readDirMock).not.toHaveBeenCalledWith('/drive/a/deep')
        expect(tree[0]).toEqual({
            kind: 'directory',
            name: 'a',
            path: '/drive/a',
            children: [
                { kind: 'directory', name: 'deep', path: '/drive/a/deep', children: [], truncated: true },
                { kind: 'file', name: '1.md', path: '/drive/a/1.md' },
                { kind: 'file', name: '2.md', path: '/drive/a/2.md' },
            ],
        })
        expect(tree.map((node) => node.name)).toEqual(['a', 'b', 'top.md'])
        // A normal folder is read to the end.
        readDirMock.mockClear()
        expect(isTreeTruncated(await listWorkspaceTree('/drive'))).toBe(false)
        expect(readDirMock).toHaveBeenCalledWith('/drive/a/deep')
    })

    it('stops reading when the read is replaced, and rejects instead of returning part of the tree', async () => {
        const controller = new AbortController()
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === '/ws') {
                // Another folder is picked while the first listing is still on its way.
                controller.abort()
                return [{ name: 'sub', isDirectory: true, isFile: false, isSymlink: false }]
            }
            return []
        })

        await expect(listWorkspaceTree('/ws', { signal: controller.signal })).rejects.toThrow()
        expect(readDirMock).toHaveBeenCalledTimes(1)
    })

    it('lists several folders at once, never more than eight, and builds the same tree', async () => {
        let running = 0
        let mostAtOnce = 0
        const folders = Array.from({ length: 20 }, (_, i) => `f${String(i).padStart(2, '0')}`)
        readDirMock.mockImplementation(async (dirPath: string) => {
            running += 1
            mostAtOnce = Math.max(mostAtOnce, running)
            await new Promise((resolve) => setTimeout(resolve, 1))
            running -= 1
            if (dirPath === '/ws') return folders.map((name) => ({ name, isDirectory: true, isFile: false, isSymlink: false }))
            if (dirPath.endsWith('/deep')) return [{ name: 'leaf.md', isDirectory: false, isFile: true, isSymlink: false }]
            return [
                { name: 'deep', isDirectory: true, isFile: false, isSymlink: false },
                { name: 'a.md', isDirectory: false, isFile: true, isSymlink: false },
            ]
        })

        const tree = await listWorkspaceTree('/ws')

        expect(mostAtOnce).toBe(8)
        expect(readDirMock).toHaveBeenCalledTimes(41)
        expect(tree.map((node) => node.name)).toEqual(folders)
        expect(tree[3]).toEqual({
            kind: 'directory',
            name: 'f03',
            path: '/ws/f03',
            children: [
                {
                    kind: 'directory',
                    name: 'deep',
                    path: '/ws/f03/deep',
                    children: [{ kind: 'file', name: 'leaf.md', path: '/ws/f03/deep/leaf.md' }],
                },
                { kind: 'file', name: 'a.md', path: '/ws/f03/a.md' },
            ],
        })
    })

    it('skips tool, cache and app data folders that never hold documents', async () => {
        const skipped = ['.venv', '__pycache__', '.gradle', 'AppData', 'Node_Modules']
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\Users\\me') {
                return [
                    ...[...skipped, 'Documents'].map((name) => ({ name, isDirectory: true, isFile: false, isSymlink: false })),
                    { name: 'NTUSER.DAT', isDirectory: false, isFile: true, isSymlink: false },
                ]
            }
            return [{ name: 'notes.md', isDirectory: false, isFile: true, isSymlink: false }]
        })

        const tree = await listWorkspaceTree('C:\\Users\\me')

        expect(tree.map((node) => node.name)).toEqual(['Documents', 'NTUSER.DAT'])
        expect(readDirMock).toHaveBeenCalledTimes(2)
    })

    it("shows a folder named AppData that isn't the one in a user's home folder", async () => {
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\work\\guide') return [{ name: 'AppData', isDirectory: true, isFile: false, isSymlink: false }]
            return [{ name: 'storage.md', isDirectory: false, isFile: true, isSymlink: false }]
        })

        const tree = await listWorkspaceTree('C:\\work\\guide')

        expect(tree).toEqual([
            {
                kind: 'directory',
                name: 'AppData',
                path: 'C:\\work\\guide\\AppData',
                children: [{ kind: 'file', name: 'storage.md', path: 'C:\\work\\guide\\AppData\\storage.md' }],
            },
        ])
    })

    it('shows build, dist and target folders unless they sit next to the project file that makes them', async () => {
        const dir = (name: string) => ({ name, isDirectory: true, isFile: false, isSymlink: false })
        const file = (name: string) => ({ name, isDirectory: false, isFile: true, isSymlink: false })
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\book')
                return [dir('build'), dir('Dist'), dir('target'), dir('coverage'), dir('Pods'), dir('obj'), dir('app'), dir('api')]
            if (dirPath === 'C:\\book\\app') return [file('package.json'), dir('Build'), dir('dist'), dir('coverage'), dir('target')]
            if (dirPath === 'C:\\book\\api')
                return [file('Cargo.toml'), file('Api.csproj'), file('Podfile'), dir('target'), dir('obj'), dir('Pods'), dir('build')]
            return [file('notes.md')]
        })

        const tree = await listWorkspaceTree('C:\\book')
        const names = (nodes: typeof tree): string[] => nodes.map((node) => node.name)
        const inside = (name: string): string[] => {
            const folder = tree.find((node) => node.name === name)
            return folder?.kind === 'directory' ? names(folder.children) : []
        }

        expect(names(tree)).toEqual(['api', 'app', 'build', 'coverage', 'Dist', 'obj', 'Pods', 'target'])
        expect(inside('app')).toEqual(['target', 'package.json'])
        expect(inside('api')).toEqual(['build', 'Api.csproj', 'Cargo.toml', 'Podfile'])
        expect(readDirMock).not.toHaveBeenCalledWith('C:\\book\\app\\Build')
        expect(readDirMock).not.toHaveBeenCalledWith('C:\\book\\api\\target')
    })

    it('follows links and junctions to folders and files, but not links inside a linked folder', async () => {
        const link = (name: string) => ({ name, isDirectory: false, isFile: false, isSymlink: true })
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\ws') return [link('shared'), link('todo.md'), link('My Music'), link('gone')]
            if (dirPath === 'C:\\ws\\shared') {
                return [{ name: 'a.md', isDirectory: false, isFile: true, isSymlink: false }, link('back-to-ws')]
            }
            if (dirPath === 'C:\\ws\\My Music') throw 'Access is denied. (os error 5)'
            throw new Error(`unexpected read of ${dirPath}`)
        })
        statMock.mockImplementation(async (path: string) => {
            if (path === 'C:\\ws\\gone') throw 'The system cannot find the file specified. (os error 2)'
            const isFile = path.endsWith('.md')
            return { isFile, isDirectory: !isFile, isSymlink: false, size: 1, mtime: null, nlink: null }
        })

        const tree = await listWorkspaceTree('C:\\ws')

        expect(tree).toEqual([
            { kind: 'directory', name: 'shared', path: 'C:\\ws\\shared', children: [{ kind: 'file', name: 'a.md', path: 'C:\\ws\\shared\\a.md' }] },
            { kind: 'file', name: 'todo.md', path: 'C:\\ws\\todo.md' },
        ])
        expect(statMock).not.toHaveBeenCalledWith('C:\\ws\\shared\\back-to-ws')
    })

    it('keeps links that lead outside the opened folder, marked, instead of dropping them', async () => {
        const link = (name: string) => ({ name, isDirectory: false, isFile: false, isSymlink: true })
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\Users\\me\\Documents') return [link('shared notes'), link('plan.md'), link('My Videos'), link('node_modules')]
            throw new Error(`unexpected read of ${dirPath}`)
        })
        // How the app refuses a path whose real target is outside the folders it was given.
        statMock.mockImplementation(async (path: string) => {
            throw `forbidden path: ${path}`
        })

        const tree = await listWorkspaceTree('C:\\Users\\me\\Documents')

        expect(tree).toEqual([
            {
                kind: 'directory',
                name: 'shared notes',
                path: 'C:\\Users\\me\\Documents\\shared notes',
                children: [],
                unreadable: true,
                linksOutside: true,
            },
            { kind: 'file', name: 'plan.md', path: 'C:\\Users\\me\\Documents\\plan.md' },
        ])
    })

    it('finds the folders the file list hides inside a folder, without following links', async () => {
        const dir = (name: string) => ({ name, isDirectory: true, isFile: false, isSymlink: false })
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\ws\\proj')
                return [dir('.git'), dir('site'), dir('locked'), { name: 'shared', isDirectory: false, isFile: false, isSymlink: true }]
            if (dirPath === 'C:\\ws\\proj\\site')
                return [{ name: 'package.json', isDirectory: false, isFile: true, isSymlink: false }, dir('dist'), dir('pages')]
            if (dirPath === 'C:\\ws\\proj\\site\\pages') return []
            if (dirPath === 'C:\\ws\\proj\\locked') throw 'Access is denied. (os error 5)'
            throw new Error(`unexpected read of ${dirPath}`)
        })

        await expect(findHiddenFolders('C:\\ws\\proj')).resolves.toEqual(['.git', 'site\\dist'])
        await expect(findHiddenFolders('C:\\ws\\proj', 1)).resolves.toEqual(['.git'])
    })

    it('still fails when the folder itself cannot be read', async () => {
        readDirMock.mockRejectedValue('The system cannot find the path specified. (os error 3)')
        await expect(listWorkspaceTree('E:\\gone')).rejects.toBe('The system cannot find the path specified. (os error 3)')
    })

    it('sorts sibling files by name', async () => {
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === '/ws') {
                return [
                    { name: 'b.mmd', isDirectory: false, isFile: true, isSymlink: false },
                    { name: 'a.mmd', isDirectory: false, isFile: true, isSymlink: false },
                    { name: 'z-dir', isDirectory: true, isFile: false, isSymlink: false },
                ]
            }
            return []
        })

        const tree = await listWorkspaceTree('/ws')
        expect(tree.map((node) => node.name)).toEqual(['z-dir', 'a.mmd', 'b.mmd'])
    })

    it('builds Windows tree paths with the same separators as joinPath', async () => {
        readDirMock.mockImplementation(async (dirPath: string) => {
            if (dirPath === 'C:\\ws') {
                return [
                    { name: 'sub', isDirectory: true, isFile: false, isSymlink: false },
                    { name: 'flow.mmd', isDirectory: false, isFile: true, isSymlink: false },
                ]
            }
            if (dirPath === 'C:\\ws\\sub') {
                return [{ name: 'a.md', isDirectory: false, isFile: true, isSymlink: false }]
            }
            return []
        })

        const tree = await listWorkspaceTree('C:\\ws\\')
        expect(tree[0]).toMatchObject({ kind: 'directory', path: 'C:\\ws\\sub' })
        expect(tree[0]?.kind === 'directory' && tree[0].children[0]?.path).toBe(joinPath('C:\\ws\\sub', 'a.md'))
        expect(tree[1]?.path).toBe(joinPath('C:\\ws', 'flow.mmd'))
        expect(tree[1]?.path).toBe('C:\\ws\\flow.mmd')
    })

    it('reads workspace file size through Tauri', async () => {
        statMock.mockResolvedValue({ size: 4096 })
        await expect(getWorkspaceFileSize('/ws/diagram.mmd')).resolves.toBe(4096)
        expect(statMock).toHaveBeenCalledWith('/ws/diagram.mmd')
    })

    it('returns null when file size is unavailable', async () => {
        statMock.mockResolvedValue({ size: undefined })
        await expect(getWorkspaceFileSize('/ws/diagram.mmd')).resolves.toBeNull()
    })

    it('returns null when stat fails', async () => {
        statMock.mockRejectedValue(new Error('missing'))
        await expect(getWorkspaceFileSize('/ws/missing.mmd')).resolves.toBeNull()
    })

    it('returns empty results outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await expect(listWorkspaceTree('/ws')).resolves.toEqual([])
        await expect(readWorkspaceFile('/ws/a.mmd')).resolves.toBe('')
        await expect(getWorkspaceFileSize('/ws/a.mmd')).resolves.toBeNull()
        await writeWorkspaceFile('/ws/a.mmd', 'x')
        await createWorkspaceDirectory('/ws/docs')
        await createWorkspaceFile('/ws/docs/readme.md', '# Hello')
        await renameWorkspacePath('/ws/old.mmd', '/ws/new.mmd')
        await removeWorkspacePath('/ws/new.mmd')
        await duplicateWorkspaceFile('/ws/source.mmd', '/ws/copy.mmd')
        await expect(listFolderNames('/ws')).resolves.toEqual([])
        expect(writeTextFileMock).not.toHaveBeenCalled()
        expect(writeFileMock).not.toHaveBeenCalled()
        expect(mkdirMock).not.toHaveBeenCalled()
        expect(renameMock).not.toHaveBeenCalled()
        expect(removeMock).not.toHaveBeenCalled()
        expect(copyFileMock).not.toHaveBeenCalled()
        expect(statMock).not.toHaveBeenCalled()
    })
})

describe('watching the opened folder', () => {
    type Event = Parameters<typeof classifyWatchEvent>[1]
    const event = (type: Event['type'], ...paths: string[]): Event => ({ type, paths, attrs: null })

    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
    })

    it('sorts what was added, removed and changed', () => {
        const root = 'C:\\ws'
        expect(classifyWatchEvent(root, event({ create: { kind: 'any' } }, 'C:\\ws\\a.md'))).toEqual({
            added: ['C:\\ws\\a.md'],
            removed: [],
            changed: [],
        })
        expect(classifyWatchEvent(root, event({ remove: { kind: 'any' } }, 'C:\\ws\\a.md'))).toEqual({
            added: [],
            removed: ['C:\\ws\\a.md'],
            changed: [],
        })
        expect(classifyWatchEvent(root, event({ modify: { kind: 'any' } }, 'C:\\ws\\a.md'))).toEqual({
            added: [],
            removed: [],
            changed: ['C:\\ws\\a.md'],
        })
        expect(classifyWatchEvent(root, event({ modify: { kind: 'rename', mode: 'both' } }, 'C:\\ws\\a.md', 'C:\\ws\\b.md'))).toEqual({
            added: ['C:\\ws\\b.md'],
            removed: ['C:\\ws\\a.md'],
            changed: [],
        })
        expect(classifyWatchEvent(root, event('any', 'C:\\ws\\a.md'))).toEqual({ added: ['C:\\ws\\a.md'], removed: ['C:\\ws\\a.md'], changed: [] })
    })

    it('leaves out reads, save temporary files and tool folders', () => {
        const root = 'C:\\ws'
        expect(classifyWatchEvent(root, event({ access: { kind: 'open', mode: 'read' } }, 'C:\\ws\\a.md'))).toBeNull()
        expect(classifyWatchEvent(root, event({ create: { kind: 'any' } }, 'C:\\ws\\.scrivon-save-ab12cd34.tmp'))).toBeNull()
        expect(classifyWatchEvent(root, event({ modify: { kind: 'any' } }, 'C:\\ws\\.git\\index', 'C:\\ws\\node_modules\\x\\y.js'))).toBeNull()
        // A save renames its temporary file over the real one: only the real one is left.
        expect(
            classifyWatchEvent(root, event({ modify: { kind: 'rename', mode: 'both' } }, 'C:\\ws\\.scrivon-save-ab12cd34.tmp', 'C:\\ws\\a.md'))
        ).toEqual({
            added: ['C:\\ws\\a.md'],
            removed: [],
            changed: [],
        })
    })

    it('watches the whole folder without reading it all first, and passes on what is left in one go', async () => {
        vi.useFakeTimers()
        try {
            const unwatch = vi.fn()
            watchMock.mockResolvedValue(unwatch)
            const onChange = vi.fn()

            const stop = await watchWorkspace('/ws/', onChange)

            // No delayMs: with one, plugin-fs walks the whole folder (a whole drive, even) before it watches.
            expect(watchMock).toHaveBeenCalledExactlyOnceWith('/ws', expect.any(Function), { recursive: true })
            const report = watchMock.mock.calls[0]![1] as (e: Event) => void
            report(event({ modify: { kind: 'any' } }, '/ws/.git/HEAD'))
            report(event({ create: { kind: 'file' } }, '/ws/new.md'))
            report(event({ modify: { kind: 'rename', mode: 'from' } }, '/ws/old.md'))
            expect(onChange).not.toHaveBeenCalled()
            vi.advanceTimersByTime(300)
            expect(onChange).toHaveBeenCalledExactlyOnceWith({ added: ['/ws/new.md'], removed: ['/ws/old.md'], changed: [] })

            // Nothing is reported once watching stops, not even what came in just before.
            report(event({ create: { kind: 'file' } }, '/ws/late.md'))
            stop()
            vi.advanceTimersByTime(300)
            expect(onChange).toHaveBeenCalledTimes(1)
            expect(unwatch).toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('does nothing outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        const stop = await watchWorkspace('/ws', vi.fn())
        stop()
        expect(watchMock).not.toHaveBeenCalled()
    })
})

describe('isFileMissingError', () => {
    it('is true only for a file or folder that is not there', () => {
        expect(isFileMissingError('failed to open file: The system cannot find the file specified. (os error 2)')).toBe(true)
        expect(isFileMissingError(new Error('The system cannot find the path specified. (os error 3)'))).toBe(true)
        expect(isFileMissingError('The process cannot access the file because it is being used by another process. (os error 32)')).toBe(false)
        expect(isFileMissingError('Access is denied. (os error 5)')).toBe(false)
        expect(isFileMissingError({ code: 2 })).toBe(false)
    })
})
