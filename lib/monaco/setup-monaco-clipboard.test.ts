// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real Monaco, with everything setup-monaco.ts loads, so nothing in it sets Monaco's services up before the
// clipboard is handed over (which would quietly leave Monaco's own in place).
const clipboard = vi.hoisted(() => ({
    readClipboardText: vi.fn(async () => 'from Tauri'),
    writeClipboardText: vi.fn<(text: string) => Promise<void>>(async () => {}),
}))
vi.mock('@/lib/tauri/clipboard', () => clipboard)
vi.mock('@monaco-editor/react', () => ({ loader: { config: () => {} } }))

const browserClipboard = { read: vi.fn(), readText: vi.fn(), write: vi.fn(), writeText: vi.fn() }
Object.defineProperty(navigator, 'clipboard', { value: browserClipboard, configurable: true })

await import('./setup-monaco')
const { StandaloneServices } = await import('monaco-editor/editor/standalone/browser/standaloneServices.js')
const { IClipboardService } = await import('monaco-editor/platform/clipboard/common/clipboardService.js')

beforeEach(() => {
    vi.clearAllMocks()
})

describe("the editor's clipboard", () => {
    it('reads through Tauri, and finds no copied files on Ctrl+V without asking the browser', async () => {
        const service = StandaloneServices.get(IClipboardService)

        await expect(service.readText()).resolves.toBe('from Tauri')
        await expect(service.readResources()).resolves.toEqual([])

        expect(clipboard.readClipboardText).toHaveBeenCalledTimes(1)
        expect(browserClipboard.read).not.toHaveBeenCalled()
        expect(browserClipboard.readText).not.toHaveBeenCalled()
    })

    it("writes through Tauri, as the hover popup's Copy button does", async () => {
        await StandaloneServices.get(IClipboardService).writeText('Unknown word')

        expect(clipboard.writeClipboardText).toHaveBeenCalledWith('Unknown word')
        expect(browserClipboard.writeText).not.toHaveBeenCalled()
        expect(browserClipboard.write).not.toHaveBeenCalled()
    })
})
