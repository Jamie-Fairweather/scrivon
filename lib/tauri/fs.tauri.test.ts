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
    existsMock,
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
    existsMock: vi.fn(),
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: isTauriMock,
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
    exists: existsMock,
}))

import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getWorkspaceFileSize,
    joinPath,
    listFolderNames,
    listWorkspaceTree,
    PathExistsError,
    readWorkspaceFile,
    readWorkspaceTextFile,
    removeWorkspacePath,
    renameWorkspacePath,
    writeWorkspaceFile,
} from './fs'

describe('workspace fs (Tauri)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
        existsMock.mockResolvedValue(false)
    })

    it('reads workspace files through Tauri', async () => {
        readFileMock.mockResolvedValue(new TextEncoder().encode('graph TD\n  A --> B'))
        await expect(readWorkspaceFile('/ws/diagram.mmd')).resolves.toBe('graph TD\n  A --> B')
        expect(readFileMock).toHaveBeenCalledWith('/ws/diagram.mmd')
    })

    it('writes workspace files through Tauri as UTF-8 by default', async () => {
        await writeWorkspaceFile('/ws/diagram.mmd', 'updated é')
        expect(writeFileMock).toHaveBeenCalledWith('/ws/diagram.mmd', new TextEncoder().encode('updated é'))
    })

    it('saves a UTF-16 file with a byte-order mark the way it was read', async () => {
        // "# Café" as Windows PowerShell 5.1 writes it.
        const original = new Uint8Array([0xff, 0xfe, 0x23, 0x00, 0x20, 0x00, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00])
        readFileMock.mockResolvedValue(original)
        const file = await readWorkspaceTextFile('C:\\ws\\notes.md')
        expect(file).toEqual({ content: '# Café', format: { encoding: 'utf-16le', bom: true } })

        await writeWorkspaceFile('C:\\ws\\notes.md', file.content, file.format)
        expect(writeFileMock).toHaveBeenCalledWith('C:\\ws\\notes.md', original)
    })

    it('keeps the byte-order mark of a UTF-8 file and flags an ANSI file', async () => {
        const withMark = new Uint8Array([0xef, 0xbb, 0xbf, 0x41])
        readFileMock.mockResolvedValueOnce(withMark)
        const file = await readWorkspaceTextFile('/ws/a.md')
        await writeWorkspaceFile('/ws/a.md', file.content, file.format)
        expect(writeFileMock).toHaveBeenCalledWith('/ws/a.md', withMark)

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
        await duplicateWorkspaceFile('/ws/source.mmd', '/ws/copy.mmd', 'UNSAVED')
        expect(writeTextFileMock).toHaveBeenCalledWith('/ws/copy.mmd', 'UNSAVED', { createNew: true })
        expect(readFileMock).not.toHaveBeenCalled()

        existsMock.mockResolvedValue(true)
        await expect(duplicateWorkspaceFile('/ws/source.mmd', '/ws/taken.mmd')).rejects.toBeInstanceOf(PathExistsError)
        expect(writeFileMock).not.toHaveBeenCalled()
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
                    { name: 'link', isDirectory: false, isFile: false, isSymlink: true },
                    { name: 'b.mmd', isDirectory: false, isFile: true, isSymlink: false },
                    { name: 'docs', isDirectory: true, isFile: false, isSymlink: false },
                ]
            }
            if (dirPath === '/ws/docs') {
                return [{ name: 'a.md', isDirectory: false, isFile: true, isSymlink: false }]
            }
            return []
        })

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
