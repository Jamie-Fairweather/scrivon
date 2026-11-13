import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyError, notifyInfo, notifySuccess } from '@/lib/notify'
import { copyPath, relativeToWorkspace, revealInFileExplorer } from './path-actions'

const { revealItemInDir } = vi.hoisted(() => ({ revealItemInDir: vi.fn<(path: string) => Promise<void>>(async () => undefined) }))

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }))
vi.mock('@/lib/notify', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn() }))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(clipboard: Partial<Clipboard> | undefined) {
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
}

beforeEach(() => {
    vi.clearAllMocks()
})

afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
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
    it('puts the path on the clipboard and confirms with a toast', async () => {
        const writeText = vi.fn(async () => undefined)
        setClipboard({ writeText })

        await copyPath('C:\\Work\\notes\\plan.md')

        expect(writeText).toHaveBeenCalledWith('C:\\Work\\notes\\plan.md')
        expect(notifySuccess).toHaveBeenCalledWith('Path copied', { description: 'C:\\Work\\notes\\plan.md' })
    })

    it('names a relative path in the toast', async () => {
        setClipboard({ writeText: vi.fn(async () => undefined) })

        await copyPath('docs\\plan.md', 'relative')

        expect(notifySuccess).toHaveBeenCalledWith('Relative path copied', { description: 'docs\\plan.md' })
    })

    it('says so when the clipboard refuses, or there is none', async () => {
        const denied = new Error('Not allowed')
        setClipboard({ writeText: vi.fn(async () => Promise.reject(denied)) })
        await copyPath('C:\\Work\\notes\\plan.md')
        expect(notifyError).toHaveBeenLastCalledWith("Couldn't copy the path", denied)

        setClipboard(undefined)
        await copyPath('C:\\Work\\notes\\plan.md')
        expect(notifyError).toHaveBeenLastCalledWith("Couldn't copy the path", expect.any(Error))
        expect(notifySuccess).not.toHaveBeenCalled()
    })
})
