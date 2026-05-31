import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isTauriMock, saveMock, openMock, messageMock, writeFileMock, writeTextFileMock, allowWorkspacePathMock } = vi.hoisted(() => ({
    isTauriMock: vi.fn(),
    saveMock: vi.fn(),
    openMock: vi.fn(),
    messageMock: vi.fn(),
    writeFileMock: vi.fn(),
    writeTextFileMock: vi.fn(),
    allowWorkspacePathMock: vi.fn(),
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri: isTauriMock,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: saveMock,
    open: openMock,
    message: messageMock,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: writeFileMock,
    writeTextFile: writeTextFileMock,
}))

vi.mock('@/lib/tauri/scope', () => ({
    allowWorkspacePath: allowWorkspacePathMock,
}))

import { pickSavePath, pickWorkspaceFolder, showError, writeBinaryFile, writeTextFileAtPath } from './dialog'

describe('pickSavePath', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns null outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await expect(pickSavePath({ title: 'Save' })).resolves.toBeNull()
        expect(saveMock).not.toHaveBeenCalled()
    })

    it('returns the selected path in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        saveMock.mockResolvedValue('/tmp/export.pdf')
        await expect(pickSavePath({ title: 'Save' })).resolves.toBe('/tmp/export.pdf')
    })

    it('returns null when save is cancelled or returns an array', async () => {
        isTauriMock.mockReturnValue(true)
        saveMock.mockResolvedValue(null)
        await expect(pickSavePath({})).resolves.toBeNull()
        saveMock.mockResolvedValue(['/tmp/a', '/tmp/b'])
        await expect(pickSavePath({})).resolves.toBeNull()
    })
})

describe('pickWorkspaceFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns null outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await expect(pickWorkspaceFolder()).resolves.toBeNull()
    })

    it('allows workspace scope and returns the folder path', async () => {
        isTauriMock.mockReturnValue(true)
        openMock.mockResolvedValue('/home/project')
        await expect(pickWorkspaceFolder()).resolves.toBe('/home/project')
        expect(allowWorkspacePathMock).toHaveBeenCalledWith('/home/project')
    })

    it('returns null when folder selection is cancelled', async () => {
        isTauriMock.mockReturnValue(true)
        openMock.mockResolvedValue(null)
        await expect(pickWorkspaceFolder()).resolves.toBeNull()
        expect(allowWorkspacePathMock).not.toHaveBeenCalled()
    })
})

describe('writeBinaryFile', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('no-ops outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await writeBinaryFile('/tmp/file.bin', new Uint8Array([1, 2]))
        expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('writes bytes in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        const bytes = new Uint8Array([1, 2, 3])
        await writeBinaryFile('/tmp/file.bin', bytes)
        expect(writeFileMock).toHaveBeenCalledWith('/tmp/file.bin', bytes)
    })
})

describe('writeTextFileAtPath', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('no-ops outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await writeTextFileAtPath('/tmp/file.txt', 'hello')
        expect(writeTextFileMock).not.toHaveBeenCalled()
    })

    it('writes text in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        await writeTextFileAtPath('/tmp/file.txt', 'hello')
        expect(writeTextFileMock).toHaveBeenCalledWith('/tmp/file.txt', 'hello')
    })
})

describe('showError', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('logs to console outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        await showError('Title', 'Body')
        expect(errorSpy).toHaveBeenCalledWith('Title', 'Body')
        errorSpy.mockRestore()
    })

    it('shows a native dialog in Tauri', async () => {
        isTauriMock.mockReturnValue(true)
        await showError('Title', 'Body')
        expect(messageMock).toHaveBeenCalledWith('Body', { title: 'Title', kind: 'error' })
    })
})
