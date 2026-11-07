import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { getWorkspaceFileStamp } from '@/lib/tauri/file-stamp'

vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn() }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: vi.fn() }))

type FileInfo = Awaited<ReturnType<typeof stat>>

function info(size: unknown, mtime: Date | null): FileInfo {
    return { size, mtime } as unknown as FileInfo
}

describe('getWorkspaceFileStamp', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(true)
    })

    it('gives the size and the time the file was last changed', async () => {
        vi.mocked(stat).mockResolvedValue(info(14, new Date(1_700_000_000_000)))

        await expect(getWorkspaceFileStamp('C:\\work\\a.md')).resolves.toEqual({ size: 14, mtimeMs: 1_700_000_000_000 })
        expect(stat).toHaveBeenCalledWith('C:\\work\\a.md')
    })

    it('leaves the time out when the system gives none, or a broken one', async () => {
        vi.mocked(stat).mockResolvedValueOnce(info(3, null))
        await expect(getWorkspaceFileStamp('/a.md')).resolves.toEqual({ size: 3, mtimeMs: null })

        vi.mocked(stat).mockResolvedValueOnce(info(3, new Date(Number.NaN)))
        await expect(getWorkspaceFileStamp('/a.md')).resolves.toEqual({ size: 3, mtimeMs: null })
    })

    it('gives null when the file cannot be looked at, has no size, or outside the desktop app', async () => {
        vi.mocked(stat).mockRejectedValueOnce(new Error('gone'))
        await expect(getWorkspaceFileStamp('/a.md')).resolves.toBeNull()

        vi.mocked(stat).mockResolvedValueOnce(info(undefined, null))
        await expect(getWorkspaceFileStamp('/a.md')).resolves.toBeNull()

        vi.mocked(isTauri).mockReturnValue(false)
        await expect(getWorkspaceFileStamp('/a.md')).resolves.toBeNull()
        expect(stat).toHaveBeenCalledTimes(2)
    })
})
