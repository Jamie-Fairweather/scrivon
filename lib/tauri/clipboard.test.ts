import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
    readText: vi.fn<() => Promise<string>>(),
    readImage: vi.fn(),
    writeText: vi.fn<(text: string) => Promise<void>>(),
    writeImage: vi.fn<(image: Uint8Array) => Promise<void>>(),
}))
const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => plugin)
vi.mock('@/lib/tauri/platform', () => platform)

const { readClipboardPng, readClipboardText, writeClipboardPng, writeClipboardText } = await import('./clipboard')

/** What the plugin rejects with when the clipboard has nothing of the kind asked for (arboard's ContentNotAvailable). */
const NOTHING_THERE = 'The clipboard contents were not available in the requested format or the clipboard is empty.'

/** The start of a PNG file: what the drawing surface below turns pixels into. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/** A picture Tauri read off the clipboard: its pixels (RGBA, row by row) and size, held until closed. */
function clipboardImage(rgba: Uint8Array, width: number, height: number) {
    return { rgba: vi.fn(async () => rgba), size: vi.fn(async () => ({ width, height })), close: vi.fn(async () => {}) }
}

/** The browser's OffscreenCanvas, which turns pixels into a PNG. Returns what was drawn and saved, one entry per canvas. */
function drawingSurface() {
    const drawn: { width: number; height: number; pixels: number[]; type?: string }[] = []
    class FakeCanvas {
        constructor(width: number, height: number) {
            drawn.push({ width, height, pixels: [] })
        }
        getContext() {
            const entry = drawn.at(-1)!
            return {
                createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
                putImageData: (image: { data: Uint8ClampedArray }) => (entry.pixels = [...image.data]),
            }
        }
        async convertToBlob({ type }: { type: string }) {
            drawn.at(-1)!.type = type
            return new Blob([PNG], { type })
        }
    }
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    return drawn
}

beforeEach(() => {
    vi.clearAllMocks()
    platform.isTauri.mockReturnValue(true)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('in the app', () => {
    it('reads the text through Tauri', async () => {
        plugin.readText.mockResolvedValue('Hello')

        await expect(readClipboardText()).resolves.toBe('Hello')
    })

    it('reads no text as empty, and says why when the clipboard fails', async () => {
        plugin.readText.mockRejectedValueOnce(NOTHING_THERE)
        await expect(readClipboardText()).resolves.toBe('')

        plugin.readText.mockRejectedValueOnce('The native clipboard is not accessible due to being held by another party.')
        await expect(readClipboardText()).rejects.toBe('The native clipboard is not accessible due to being held by another party.')
    })

    it('reads a picture as PNG bytes, from the pixels Tauri gives', async () => {
        const drawn = drawingSurface()
        const picture = clipboardImage(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]), 2, 1)
        plugin.readImage.mockResolvedValue(picture)

        await expect(readClipboardPng()).resolves.toEqual(PNG)

        expect(drawn).toEqual([{ width: 2, height: 1, pixels: [255, 0, 0, 255, 0, 0, 255, 128], type: 'image/png' }])
        // Tauri keeps the picture until the page lets it go.
        expect(picture.close).toHaveBeenCalled()
    })

    it('reads no picture as null, and says why when the clipboard fails', async () => {
        plugin.readImage.mockRejectedValueOnce(NOTHING_THERE)
        await expect(readClipboardPng()).resolves.toBeNull()

        plugin.readImage.mockRejectedValueOnce('failed to read clipboard PNG data')
        await expect(readClipboardPng()).rejects.toBe('failed to read clipboard PNG data')
    })

    it('writes text and PNG pictures through Tauri', async () => {
        await writeClipboardText('C:\\notes\\plan.md')
        await writeClipboardPng(PNG)

        expect(plugin.writeText).toHaveBeenCalledWith('C:\\notes\\plan.md')
        expect(plugin.writeImage).toHaveBeenCalledWith(PNG)
    })

    it('says why when the clipboard refuses a write', async () => {
        plugin.writeText.mockRejectedValueOnce('The native clipboard is not accessible due to being held by another party.')

        await expect(writeClipboardText('x')).rejects.toBe('The native clipboard is not accessible due to being held by another party.')
    })
})

describe('in a plain browser (bun run dev, without Tauri)', () => {
    class FakeClipboardItem {
        constructor(readonly items: Record<string, Blob>) {}
    }

    /** The browser's own clipboard, holding `items`, each as its data by type. */
    function browserClipboard(...items: Record<string, Blob>[]) {
        const text = items.find((data) => data['text/plain'])?.['text/plain']
        const clipboard = {
            readText: vi.fn(async () => (text ? text.text() : '')),
            read: vi.fn(async () => items.map((data) => ({ types: Object.keys(data), getType: async (type: string) => data[type]! }))),
            writeText: vi.fn<(text: string) => Promise<void>>(async () => {}),
            write: vi.fn<(items: FakeClipboardItem[]) => Promise<void>>(async () => {}),
        }
        vi.stubGlobal('navigator', { clipboard })
        vi.stubGlobal('ClipboardItem', FakeClipboardItem)
        return clipboard
    }

    beforeEach(() => {
        platform.isTauri.mockReturnValue(false)
    })

    it('reads text and PNG pictures from the browser’s clipboard', async () => {
        browserClipboard({ 'text/plain': new Blob(['Hello']) }, { 'image/png': new Blob([PNG], { type: 'image/png' }) })

        await expect(readClipboardText()).resolves.toBe('Hello')
        await expect(readClipboardPng()).resolves.toEqual(PNG)
        expect(plugin.readText).not.toHaveBeenCalled()
        expect(plugin.readImage).not.toHaveBeenCalled()
    })

    it('reads no picture as null', async () => {
        browserClipboard({ 'text/html': new Blob(['<b>x</b>']) })

        await expect(readClipboardPng()).resolves.toBeNull()
    })

    it('writes text and PNG pictures to the browser’s clipboard', async () => {
        const clipboard = browserClipboard()

        await writeClipboardText('Hello')
        await writeClipboardPng(PNG)

        expect(clipboard.writeText).toHaveBeenCalledWith('Hello')
        const [[written]] = clipboard.write.mock.calls
        expect(Object.keys(written![0]!.items)).toEqual(['image/png'])
        expect(new Uint8Array(await written![0]!.items['image/png']!.arrayBuffer())).toEqual(PNG)
        expect(plugin.writeText).not.toHaveBeenCalled()
        expect(plugin.writeImage).not.toHaveBeenCalled()
    })

    it('says so where the page may not use the clipboard', async () => {
        vi.stubGlobal('navigator', {})
        const missing = new Error('The clipboard is not available.')

        await expect(readClipboardText()).rejects.toEqual(missing)
        await expect(readClipboardPng()).rejects.toEqual(missing)
        await expect(writeClipboardText('x')).rejects.toEqual(missing)
        await expect(writeClipboardPng(PNG)).rejects.toEqual(missing)
    })
})
