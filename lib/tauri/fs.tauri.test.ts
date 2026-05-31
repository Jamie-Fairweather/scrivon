import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, readDirMock, readTextFileMock, writeTextFileMock, mkdirMock, renameMock, removeMock, copyFileMock, statMock } = vi.hoisted(
    () => ({
        isTauriMock: vi.fn(),
        readDirMock: vi.fn(),
        readTextFileMock: vi.fn(),
        writeTextFileMock: vi.fn(),
        mkdirMock: vi.fn(),
        renameMock: vi.fn(),
        removeMock: vi.fn(),
        copyFileMock: vi.fn(),
        statMock: vi.fn(),
    })
)

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: isTauriMock,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: readDirMock,
    readTextFile: readTextFileMock,
    writeTextFile: writeTextFileMock,
    mkdir: mkdirMock,
    rename: renameMock,
    remove: removeMock,
    copyFile: copyFileMock,
    stat: statMock,
}))

import {
    createWorkspaceDirectory,
    createWorkspaceFile,
    duplicateWorkspaceFile,
    getWorkspaceFileSize,
    listWorkspaceTree,
    readWorkspaceFile,
    removeWorkspacePath,
    renameWorkspacePath,
    writeWorkspaceFile,
} from './fs'

describe('workspace fs (Tauri)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
    })

    it('reads workspace files through Tauri', async () => {
        readTextFileMock.mockResolvedValue('graph TD\n  A --> B')
        await expect(readWorkspaceFile('/ws/diagram.mmd')).resolves.toBe('graph TD\n  A --> B')
    })

    it('writes workspace files through Tauri', async () => {
        await writeWorkspaceFile('/ws/diagram.mmd', 'updated')
        expect(writeTextFileMock).toHaveBeenCalledWith('/ws/diagram.mmd', 'updated')
    })

    it('creates directories and files', async () => {
        await createWorkspaceDirectory('/ws/docs')
        await createWorkspaceFile('/ws/docs/readme.md', '# Hello')
        expect(mkdirMock).toHaveBeenCalledWith('/ws/docs', { recursive: true })
        expect(writeTextFileMock).toHaveBeenCalledWith('/ws/docs/readme.md', '# Hello')
    })

    it('renames, removes, and duplicates paths', async () => {
        await renameWorkspacePath('/ws/old.mmd', '/ws/new.mmd')
        await removeWorkspacePath('/ws/new.mmd')
        await duplicateWorkspaceFile('/ws/source.mmd', '/ws/copy.mmd')
        expect(renameMock).toHaveBeenCalledWith('/ws/old.mmd', '/ws/new.mmd')
        expect(removeMock).toHaveBeenCalledWith('/ws/new.mmd')
        expect(copyFileMock).toHaveBeenCalledWith('/ws/source.mmd', '/ws/copy.mmd')
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
        expect(writeTextFileMock).not.toHaveBeenCalled()
        expect(mkdirMock).not.toHaveBeenCalled()
        expect(renameMock).not.toHaveBeenCalled()
        expect(removeMock).not.toHaveBeenCalled()
        expect(copyFileMock).not.toHaveBeenCalled()
        expect(statMock).not.toHaveBeenCalled()
    })
})
