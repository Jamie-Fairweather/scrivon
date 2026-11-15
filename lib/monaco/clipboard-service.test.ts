import { beforeEach, describe, expect, it, vi } from 'vitest'

const clipboard = vi.hoisted(() => ({
    readClipboardText: vi.fn<() => Promise<string>>(async () => 'copied'),
    writeClipboardText: vi.fn<(text: string) => Promise<void>>(async () => {}),
}))
const notify = vi.hoisted(() => ({ notifyError: vi.fn() }))
vi.mock('@/lib/tauri/clipboard', () => clipboard)
vi.mock('@/lib/notify', () => notify)

const { createMonacoClipboardService } = await import('./clipboard-service')

beforeEach(() => {
    vi.clearAllMocks()
})

describe("Monaco's clipboard, through Tauri", () => {
    it('reads and writes the clipboard through Tauri', async () => {
        const service = createMonacoClipboardService()

        await expect(service.readText()).resolves.toBe('copied')
        await service.writeText('Unknown word')

        expect(clipboard.writeClipboardText).toHaveBeenCalledWith('Unknown word')
    })

    it('keeps text Monaco stores under a name in memory, off the clipboard', async () => {
        const service = createMonacoClipboardService()

        await service.writeText('kept', 'monaco-own')

        await expect(service.readText('monaco-own')).resolves.toBe('kept')
        await expect(service.readText('other')).resolves.toBe('')
        expect(clipboard.writeClipboardText).not.toHaveBeenCalled()
        expect(clipboard.readClipboardText).not.toHaveBeenCalled()
    })

    it("keeps the find box's text in memory, as Monaco's own does", async () => {
        const service = createMonacoClipboardService()
        await expect(service.readFindText()).resolves.toBe('')

        await service.writeFindText('needle')

        await expect(service.readFindText()).resolves.toBe('needle')
        expect(clipboard.writeClipboardText).not.toHaveBeenCalled()
    })

    it('has no copied files, so Ctrl+V reads nothing extra from the clipboard', async () => {
        const service = createMonacoClipboardService()

        await service.writeResources([])
        await expect(service.readResources()).resolves.toEqual([])
        await expect(service.hasResources()).resolves.toBe(false)
        await expect(service.readImage()).resolves.toEqual(new Uint8Array())
        expect(service.triggerPaste(1)).toBeUndefined()
        expect(clipboard.readClipboardText).not.toHaveBeenCalled()
    })

    it("reads nothing when the clipboard can't be read, as Monaco's own does", async () => {
        clipboard.readClipboardText.mockRejectedValueOnce(new Error('busy'))

        await expect(createMonacoClipboardService().readText()).resolves.toBe('')
    })

    it("says so when the clipboard can't be written, instead of failing quietly", async () => {
        clipboard.writeClipboardText.mockRejectedValueOnce(new Error('busy'))

        await expect(createMonacoClipboardService().writeText('Unknown word')).resolves.toBeUndefined()

        expect(notify.notifyError).toHaveBeenCalledWith("Couldn't copy", new Error('busy'))
    })
})
