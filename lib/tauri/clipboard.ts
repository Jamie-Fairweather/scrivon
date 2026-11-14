/**
 * All clipboard reads and writes, through Tauri's clipboard plugin. Reading through the browser's
 * navigator.clipboard makes WebView2 ask the user for clipboard access (#208), so the app never does.
 * Only the plain browser build (bun run dev, without Tauri) falls back to navigator.clipboard.
 */
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { isTauri } from '@/lib/tauri/platform'

/** The browser's own clipboard, for the plain browser build only. */
function browserClipboard(): Clipboard {
    // Missing where the page may not use the clipboard (served over plain http to another machine, say).
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) throw new Error('The clipboard is not available.')
    return clipboard
}

/** What the plugin rejects with when the clipboard has nothing of the kind asked for, or nothing at all. */
function isNothingThere(error: unknown): boolean {
    return /not available in the requested format|clipboard is empty/i.test(String(error))
}

/** The clipboard's text, or '' when it has none (a picture, say). Rejects when the clipboard can't be read. */
export async function readClipboardText(): Promise<string> {
    if (!isTauri()) return browserClipboard().readText()
    try {
        return await readText()
    } catch (error) {
        if (isNothingThere(error)) return ''
        throw error
    }
}

/** Pixels (RGBA, row by row from the top) as a PNG file. */
async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error("Couldn't read the picture on the clipboard.")
    const image = context.createImageData(width, height)
    image.data.set(rgba)
    context.putImageData(image, 0, 0)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await png.arrayBuffer())
}

/** The PNG picture on the browser's clipboard, or null. */
async function readBrowserPng(): Promise<Uint8Array<ArrayBuffer> | null> {
    const items = await browserClipboard().read()
    const item = items.find((candidate) => candidate.types.includes('image/png'))
    return item ? new Uint8Array(await (await item.getType('image/png')).arrayBuffer()) : null
}

/** The picture on the clipboard as a PNG file, or null when it has none. Rejects when the clipboard can't be read. */
export async function readClipboardPng(): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!isTauri()) return readBrowserPng()
    let picture: Awaited<ReturnType<typeof readImage>>
    try {
        picture = await readImage()
    } catch (error) {
        if (isNothingThere(error)) return null
        throw error
    }
    try {
        const [rgba, { width, height }] = await Promise.all([picture.rgba(), picture.size()])
        return await encodePng(rgba, width, height)
    } finally {
        // Tauri holds the pixels until they are let go.
        void picture.close().catch(() => {})
    }
}

/** Puts text on the clipboard. */
export async function writeClipboardText(text: string): Promise<void> {
    if (!isTauri()) return browserClipboard().writeText(text)
    await writeText(text)
}

/** Puts a PNG picture on the clipboard. */
export async function writeClipboardPng(png: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!isTauri()) {
        const clipboard = browserClipboard()
        return clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
    }
    await writeImage(png)
}
