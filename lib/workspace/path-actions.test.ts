import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyError, notifyInfo, notifySuccess } from '@/lib/notify'
import { copyPath, relativeToWorkspace, revealInFileExplorer } from './path-actions'

const { revealItemInDir, writeClipboardText } = vi.hoisted(() => ({
    revealItemInDir: vi.fn<(path: string) => Promise<void>>(async () => undefined),
    writeClipboardText: vi.fn<(text: string) => Promise<void>>(async () => undefined),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }))
vi.mock('@/lib/notify', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn() }))
vi.mock('@/lib/tauri/clipboard', () => ({ writeClipboardText }))

beforeEach(() => {
    vi.clearAllMocks()
})

describe('relativeToWorkspace', () => {
    it('gives the path from the open folder, with Windows separators', () => {
        expect(relativeToWorkspace('C:\\Work\\notes\\docs\\plan.md', 'C:\\Work\\notes')).toBe('docs\\plan.md')
        expect(relativeToWorkspace('c:/work/notes/flow.mmd', 'C:\\Work\\notes')).toBe('flow.mmd')
    })

    it('gives null for a path outside the open folder, or with no folder open', () => {
        expect(relativeToWorkspace('C:\\Other\\plan.md', 'C:\\Work\\notes')).toBeNull()
        expect(relativeToWorkspace('C:\\Work\\notes', 'C:\\Work\\notes')).toBeNull()
        expect(relativeToWorkspace('C:\\Work\\notes\\plan.md', null)).toBeNull()
    })
})

describe('revealInFileExplorer', () => {
    it('shows a file or folder inside the open folder in File Explorer', async () => {
        await revealInFileExplorer('C:\\Work\\notes\\docs', 'C:\\Work\\notes')

        expect(revealItemInDir).toHaveBeenCalledWith('C:\\Work\\notes\\docs')
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('does not show anything outside the open folder, and says why', async () => {
        await revealInFileExplorer('C:\\Windows\\system32\\calc.exe', 'C:\\Work\\notes')
        await revealInFileExplorer('C:\\Work\\notes\\plan.md', null)

        expect(revealItemInDir).not.toHaveBeenCalled()
        expect(notifyInfo).toHaveBeenCalledTimes(2)
        expect(notifyInfo).toHaveBeenCalledWith("Can't show that in File Explorer", {
            description: 'Only files and folders inside the open folder can be shown.',
        })
    })

    it('says so when File Explorer could not show it', async () => {
        const err = new Error('gone')
        revealItemInDir.mockRejectedValueOnce(err)

        await revealInFileExplorer('C:\\Work\\notes\\plan.md', 'C:\\Work\\notes')

        expect(notifyError).toHaveBeenCalledWith("Couldn't show it in File Explorer", err)
    })
})

describe('copyPath', () => {
    it('puts the path on the clipboard through Tauri and confirms with a toast', async () => {
        await copyPath('C:\\Work\\notes\\plan.md')

        expect(writeClipboardText).toHaveBeenCalledWith('C:\\Work\\notes\\plan.md')
        expect(notifySuccess).toHaveBeenCalledWith('Path copied', { description: 'C:\\Work\\notes\\plan.md' })
    })

    it('names a relative path in the toast', async () => {
        await copyPath('docs\\plan.md', 'relative')

        expect(writeClipboardText).toHaveBeenCalledWith('docs\\plan.md')
        expect(notifySuccess).toHaveBeenCalledWith('Relative path copied', { description: 'docs\\plan.md' })
    })

    it('says so when the clipboard refuses', async () => {
        const occupied = 'The native clipboard is not accessible due to being held by another party.'
        writeClipboardText.mockRejectedValueOnce(occupied)

        await copyPath('C:\\Work\\notes\\plan.md')

        expect(notifyError).toHaveBeenCalledWith("Couldn't copy the path", occupied)
        expect(notifySuccess).not.toHaveBeenCalled()
    })
})
