import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({
    readText: vi.fn<() => Promise<string>>(),
    readImage: vi.fn(),
    writeText: vi.fn<(text: string) => Promise<void>>(),
    writeImage: vi.fn<(image: Uint8Array) => Promise<void>>(),
}))
const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }))
/** The app's own commands (src-tauri/src/svg_clipboard.rs). */
const core = vi.hoisted(() => ({ invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async () => undefined) }))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => plugin)
vi.mock('@tauri-apps/api/core', () => core)
vi.mock('@/lib/tauri/platform', () => platform)

const { readClipboardPng, readClipboardText, writeClipboardPng, writeClipboardSvg, writeClipboardText } = await import('./clipboard')

/** What the plugin rejects with when the clipboard has nothing of the kind asked for (arboard's ContentNotAvailable). */
const NOTHING_THERE = 'The clipboard contents were not available in the requested format or the clipboard is empty.'
/** What it rejects with when another app has the clipboard open (arboard's ClipboardOccupied). */
const HELD = 'The native clipboard is not accessible due to being held by another party.'
/** What the user is told then, with arboard's words kept for the log. */
const IN_USE = new Error('Another app is using the clipboard. Try again.', { cause: HELD })

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

        plugin.readText.mockRejectedValueOnce(HELD)
        await expect(readClipboardText()).rejects.toEqual(IN_USE)

        plugin.readText.mockRejectedValueOnce('Unknown error while interacting with the clipboard: 5')
        await expect(readClipboardText()).rejects.toBe('Unknown error while interacting with the clipboard: 5')
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

        plugin.readImage.mockRejectedValueOnce(HELD)
        await expect(readClipboardPng()).rejects.toEqual(IN_USE)
    })

    it('writes text and PNG pictures through Tauri', async () => {
        await writeClipboardText('C:\\notes\\plan.md')
        await writeClipboardPng(PNG)

        expect(plugin.writeText).toHaveBeenCalledWith('C:\\notes\\plan.md')
        expect(plugin.writeImage).toHaveBeenCalledWith(PNG)
    })

    it('writes SVG through the app’s own command, which also puts an SVG picture on the clipboard for Office', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

        await writeClipboardSvg(svg)

        expect(core.invoke).toHaveBeenCalledWith('write_clipboard_svg', { svg })
        // Not as text alone, which Office pastes as a text box of markup.
        expect(plugin.writeText).not.toHaveBeenCalled()
    })

    it('says why when the SVG can’t be put on the clipboard', async () => {
        core.invoke.mockRejectedValueOnce('Another app is using the clipboard. Try again.')

        await expect(writeClipboardSvg('<svg/>')).rejects.toBe('Another app is using the clipboard. Try again.')
    })

    it('says why when the clipboard refuses a write, in plain words when another app has it', async () => {
        plugin.writeText.mockRejectedValueOnce(HELD)
        await expect(writeClipboardText('x')).rejects.toEqual(IN_USE)

        plugin.writeImage.mockRejectedValueOnce(HELD)
        await expect(writeClipboardPng(PNG)).rejects.toEqual(IN_USE)

        plugin.writeImage.mockRejectedValueOnce('failed to write the image')
        await expect(writeClipboardPng(PNG)).rejects.toBe('failed to write the image')
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

    it('writes text and PNG pictures to the browser’s clipboard, and SVG as text', async () => {
        const clipboard = browserClipboard()

        await writeClipboardText('Hello')
        await writeClipboardPng(PNG)
        await writeClipboardSvg('<svg/>')

        expect(clipboard.writeText).toHaveBeenNthCalledWith(1, 'Hello')
        expect(clipboard.writeText).toHaveBeenNthCalledWith(2, '<svg/>')
        expect(core.invoke).not.toHaveBeenCalled()
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
        await expect(writeClipboardSvg('<svg/>')).rejects.toEqual(missing)
    })
})
