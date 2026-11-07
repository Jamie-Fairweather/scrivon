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

import {
    confirmCloseAfterSaveFailure,
    confirmUnsavedChanges,
    pickOpenFile,
    pickSavePath,
    pickWorkspaceFolder,
    showError,
    writeBinaryFile,
    writeTextFileAtPath,
} from './dialog'

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

describe('pickOpenFile', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns null outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await expect(pickOpenFile({ title: 'Choose image' })).resolves.toBeNull()
        expect(openMock).not.toHaveBeenCalled()
    })

    it('returns the file path without granting access to its folder', async () => {
        isTauriMock.mockReturnValue(true)
        openMock.mockResolvedValue('C:\\Users\\me\\Downloads\\logo.png')
        await expect(pickOpenFile({ title: 'Choose image' })).resolves.toBe('C:\\Users\\me\\Downloads\\logo.png')
        expect(openMock).toHaveBeenCalledWith(
            expect.objectContaining({
                directory: false,
                multiple: false,
                title: 'Choose image',
            })
        )
        openMock.mockResolvedValue('G:\\logo.png')
        await expect(pickOpenFile()).resolves.toBe('G:\\logo.png')
        expect(allowWorkspacePathMock).not.toHaveBeenCalled()
    })

    it('returns null when file selection is cancelled or returns an array', async () => {
        isTauriMock.mockReturnValue(true)
        openMock.mockResolvedValue(null)
        await expect(pickOpenFile({})).resolves.toBeNull()
        openMock.mockResolvedValue(['/tmp/a.png', '/tmp/b.png'])
        await expect(pickOpenFile({})).resolves.toBeNull()
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

describe('confirmUnsavedChanges', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
    })

    it('asks with Save, Don’t Save and Cancel and maps the button that was picked', async () => {
        messageMock.mockResolvedValueOnce('Save')
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('save')
        expect(messageMock).toHaveBeenCalledWith(expect.stringContaining('save the changes you made to a.md?'), {
            title: 'Unsaved changes',
            kind: 'warning',
            buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
        })

        messageMock.mockResolvedValueOnce("Don't Save")
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('discard')
        messageMock.mockResolvedValueOnce('No')
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('discard')
        messageMock.mockResolvedValueOnce('Yes')
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('save')
    })

    it('treats closing the dialog or an unknown answer as cancel', async () => {
        messageMock.mockResolvedValueOnce('Cancel')
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('cancel')
        messageMock.mockResolvedValueOnce('something else')
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('cancel')
    })

    it('lists several files, up to a limit', async () => {
        messageMock.mockResolvedValueOnce('Cancel')
        const names = Array.from({ length: 12 }, (_, i) => `file-${i + 1}.md`)
        await confirmUnsavedChanges(names)
        const body = messageMock.mock.calls[0]![0] as string
        expect(body).toContain('12 files')
        expect(body).toContain('file-10.md')
        expect(body).not.toContain('file-11.md')
        expect(body).toContain('…and 2 more')
    })

    it('never discards outside Tauri', async () => {
        isTauriMock.mockReturnValue(false)
        await expect(confirmUnsavedChanges(['a.md'])).resolves.toBe('cancel')
        expect(messageMock).not.toHaveBeenCalled()
    })
})

describe('confirmCloseAfterSaveFailure', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isTauriMock.mockReturnValue(true)
    })

    it('shows the reason and maps Try Again, Close Without Saving and Cancel', async () => {
        messageMock.mockResolvedValueOnce('Try Again')
        await expect(confirmCloseAfterSaveFailure([{ name: 'a.md', error: 'Access is denied.' }])).resolves.toBe('retry')
        const [body, options] = messageMock.mock.calls[0]!
        expect(body).toContain("couldn't save a.md")
        expect(body).toContain('Access is denied.')
        expect(options).toMatchObject({ title: "Couldn't save", buttons: { yes: 'Try Again', no: 'Close Without Saving', cancel: 'Cancel' } })

        messageMock.mockResolvedValueOnce('Close Without Saving')
        await expect(confirmCloseAfterSaveFailure([{ name: 'a.md' }, { name: 'b.md', error: 'Disk full' }])).resolves.toBe('discard')
        expect(messageMock.mock.calls[1]![0]).toContain('b.md: Disk full')

        messageMock.mockResolvedValueOnce('Cancel')
        await expect(confirmCloseAfterSaveFailure([{ name: 'a.md' }])).resolves.toBe('cancel')
    })
})
