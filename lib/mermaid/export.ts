import { getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'
import { downloadBlob } from '@/lib/download'
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { notifyFileSaved, showInFolderAction } from '@/lib/saved-file-notice'
import { pickSavePath, writeBinaryFile, writeTextFileAtPath } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import { savePathBesideDocument } from '@/lib/tauri/save-path'
import { flattenSvgForExport } from '@/lib/mermaid/flatten-svg'
import { renderMermaidDiagramForExport, type ExportRenderOptions } from '@/lib/mermaid/render'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { safeFileStem } from '@/lib/workspace/paths'

export type PngExportScale = 1 | 2 | 4

/** How an exported diagram looks: the theme it's drawn in, and whether it has a background. */
export type DiagramLook = {
    themeId: AppThemeId
    /**
     * No backdrop behind the diagram, for pasting onto slides. Boxes and label backings keep the
     * theme's colours, so lines still stop short of the text.
     */
    transparent: boolean
}

/** Where a diagram being exported comes from. */
export type DiagramExportTarget = {
    /** The tab's name, e.g. 'flow.mmd', or 'notes.md' for a diagram expanded from Markdown. */
    tabName?: string
    /** The document's path on disk. The save dialog opens in its folder. */
    tabPath?: string
    /** For a diagram expanded from Markdown: the document's text, used to number its diagrams. */
    markdown?: string
}

/** The tab name without its extension ('notes.md' -> 'notes'), made safe to use as a file name. */
export function exportBaseName(tabName: string | undefined, fallback = 'diagram'): string {
    return safeFileStem((tabName ?? '').replace(/\.[^./\\]+$/, ''), fallback)
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid(?:[ \t].*)?$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** Which of the document's top-level mermaid code blocks holds `source` (from 1), and how many there are. */
export function markdownDiagramPosition(markdown: string, source: string): { index: number; count: number } {
    const wanted = source.trim()
    let count = 0
    let index = 0
    let fence: string | null = null
    let body: string[] = []

    for (const line of markdown.split(/\r?\n/)) {
        if (fence === null) {
            const open = FENCE_OPEN.exec(line)
            if (open) {
                fence = open[1]
                body = []
            }
            continue
        }
        const close = FENCE_CLOSE.exec(line)
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
            count++
            if (!index && body.join('\n').trim() === wanted) index = count
            fence = null
            continue
        }
        body.push(line)
    }
    return { index, count }
}

/** File name without extension, e.g. 'flow', or 'notes-diagram-2' for the second diagram in notes.md. */
export function diagramFileStem(source: string, target: DiagramExportTarget): string {
    if (target.markdown === undefined) return exportBaseName(target.tabName)

    const stem = `${exportBaseName(target.tabName, 'document')}-diagram`
    const { index, count } = markdownDiagramPosition(target.markdown, source)
    return index && count > 1 ? `${stem}-${index}` : stem
}

export function buildExportSvg(source: string, themeId: AppThemeId, options?: ExportRenderOptions): string {
    const trimmed = source.trim()
    if (!trimmed) {
        throw new Error('Nothing to export.')
    }
    const svg = renderMermaidDiagramForExport(trimmed, themeId, options)
    // Text with nothing to draw yet (just `graph TD`, say) renders a 0×0 picture: don't save an empty file.
    if (!getSvgDimensions(svg)) {
        throw new Error('The diagram is empty, so there is nothing to export.')
    }
    // Standalone .svg/.png files are opened outside the browser, so bake every colour in.
    return flattenSvgForExport(svg)
}

type SaveFilters = { name: string; extensions: string[] }[]

/** A saved file: its path, or none when the web build handed it to the browser's download. Null when the user cancelled. */
type Saved = { path?: string } | null

async function saveBytes(
    bytes: Uint8Array,
    filename: string,
    documentPath: string | undefined,
    mimeType: string,
    filters: SaveFilters
): Promise<Saved> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: savePathBesideDocument(filename, documentPath), filters })
        if (!path) return null
        await writeBinaryFile(path, bytes)
        return { path }
    }

    downloadBlob(new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename)
    return {}
}

async function saveText(content: string, filename: string, documentPath: string | undefined, filters: SaveFilters): Promise<Saved> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: savePathBesideDocument(filename, documentPath), filters })
        if (!path) return null
        await writeTextFileAtPath(path, content)
        return { path }
    }

    downloadBlob(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }), filename)
    return {}
}

/**
 * Chromium can't draw a canvas wider or taller than 32,767 px or bigger than about 268 million
 * pixels, and fails without saying why. Keep to the side limit, so long thin diagrams still fit,
 * but stay well inside the area limit so big exports don't run the app out of memory (100 million
 * pixels is about 400 MB).
 */
const MAX_CANVAS_SIDE = 32_767
const MAX_CANVAS_AREA = 100_000_000
/** Below half size the labels get too small to read, and SVG is the better choice. */
const MIN_PNG_SCALE = 0.5

const PNG_TOO_LARGE_MESSAGE = 'This diagram is too big to save as a PNG. Save it as SVG instead.'
const PNG_FAILED_MESSAGE = "Couldn't create the PNG. Try a smaller size, or save as SVG."

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(url)
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Failed to load diagram for PNG export.'))
        }
        img.src = url
    })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob)
            else reject(new Error(PNG_FAILED_MESSAGE))
        }, 'image/png')
    })
}

/** The largest scale, up to `requested`, at which the diagram still fits on a canvas. */
export function fitPngScale(dims: { width: number; height: number }, requested: number): number {
    return Math.min(requested, MAX_CANVAS_SIDE / dims.width, MAX_CANVAS_SIDE / dims.height, Math.sqrt(MAX_CANVAS_AREA / (dims.width * dims.height)))
}

/**
 * Draws the SVG to a PNG at `scale`, or smaller if that would be too big for a canvas (see fitPngScale),
 * on the theme's background unless `transparent`.
 */
export async function svgToPngBlob(svg: string, themeId: AppThemeId, scale: number, { transparent = false } = {}): Promise<Blob> {
    const dims = getSvgDimensions(svg)
    if (!dims) {
        throw new Error('Could not determine diagram dimensions.')
    }

    const drawScale = fitPngScale(dims, scale)
    const width = Math.round(dims.width * drawScale)
    const height = Math.round(dims.height * drawScale)
    if (width <= 0 || height <= 0) {
        throw new Error('Invalid diagram dimensions.')
    }

    if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready
    }

    const img = await loadSvgImage(svg)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Canvas is not available.')
    }

    if (!transparent) {
        ctx.fillStyle = getDiagramColors(themeId).bg
        ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(img, 0, 0, width, height)

    return canvasToPngBlob(canvas)
}

const SVG_FILTERS = [{ name: 'SVG', extensions: ['svg'] }]
const PNG_FILTERS = [{ name: 'PNG', extensions: ['png'] }]

export async function exportSvg(source: string, { themeId, transparent }: DiagramLook, target: DiagramExportTarget): Promise<void> {
    try {
        // Other apps open this file, and some would hide halo'd labels (see ExportRenderOptions).
        const svg = buildExportSvg(source, themeId, { labelHalo: false, transparent })
        const filename = `${diagramFileStem(source, target)}.svg`
        const saved = await saveText(svg, filename, target.tabPath, SVG_FILTERS)
        // The browser shows its own download, so only a file saved to disk needs a word.
        if (saved?.path) notifyFileSaved(saved.path)
    } catch (err) {
        notifyError('Export failed', err)
    }
}

/**
 * The diagram as a PNG at `scale`, or smaller when that won't fit on a canvas. `smallerSize` is
 * the size it was shrunk to, if it was. `tooBig` is the error for one too big at any readable size.
 */
async function diagramPng(
    source: string,
    { themeId, transparent }: DiagramLook,
    scale: number,
    tooBig: string
): Promise<{ blob: Blob; smallerSize?: string }> {
    // Keep the label halo even when transparent: like the edge-label boxes, it stops lines running through the text.
    const svg = buildExportSvg(source, themeId, { transparent })
    const dims = getSvgDimensions(svg)
    if (!dims) {
        throw new Error('Could not determine diagram dimensions.')
    }

    // Shrink to fit rather than fail, but not so far that the labels can't be read.
    const drawScale = fitPngScale(dims, scale)
    if (drawScale < MIN_PNG_SCALE) {
        throw new Error(tooBig)
    }

    const blob = await svgToPngBlob(svg, themeId, drawScale, { transparent })
    if (drawScale >= scale) return { blob }
    return { blob, smallerSize: `${Math.round(dims.width * drawScale)} × ${Math.round(dims.height * drawScale)} px` }
}

export async function exportPng(source: string, look: DiagramLook, target: DiagramExportTarget, scale: PngExportScale): Promise<void> {
    try {
        const { blob, smallerSize } = await diagramPng(source, look, scale, PNG_TOO_LARGE_MESSAGE)
        const filename = `${diagramFileStem(source, target)}.png`
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const saved = await saveBytes(bytes, filename, target.tabPath, 'image/png', PNG_FILTERS)
        if (!saved) return

        const { path } = saved
        if (smallerSize) {
            const description = `This diagram is too big for ${scale}×, so it was saved at ${smallerSize}.`
            notifyWarning('Saved a smaller PNG', path ? { description, action: showInFolderAction(path) } : { description })
        } else if (path) {
            notifyFileSaved(path)
        }
    } catch (err) {
        notifyError('Export failed', err)
    }
}

/** Copied PNGs are drawn at 2×, so they stay sharp in slides and on high-DPI screens. */
const COPY_PNG_SCALE = 2
const COPY_FAILED = "Couldn't copy the diagram"
const PNG_TOO_LARGE_TO_COPY_MESSAGE = 'This diagram is too big to copy as a PNG. Copy it as SVG instead.'

/** Throws where the page isn't allowed to use the clipboard, before any drawing is done. */
function checkClipboard(): void {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('The clipboard is not available.')
    }
}

/** Puts one item on the clipboard, in each format given (MIME type -> data of that type). */
async function writeClipboard(formats: Record<string, Blob>): Promise<void> {
    await navigator.clipboard.write([new ClipboardItem(formats)])
}

/** Copies the diagram as a PNG, ready to paste into slides or a chat. */
export async function copyPng(source: string, look: DiagramLook): Promise<void> {
    try {
        checkClipboard()
        const { blob, smallerSize } = await diagramPng(source, look, COPY_PNG_SCALE, PNG_TOO_LARGE_TO_COPY_MESSAGE)
        await writeClipboard({ 'image/png': blob })
        if (smallerSize) {
            notifyWarning('Copied a smaller PNG', {
                description: `This diagram is too big for ${COPY_PNG_SCALE}×, so it was copied at ${smallerSize}.`,
            })
        } else {
            notifySuccess('Diagram copied as PNG')
        }
    } catch (err) {
        notifyError(COPY_FAILED, err)
    }
}

/** Copies the diagram as SVG: a picture for apps that take one (Office), and the markup as text for the rest. */
export async function copySvg(source: string, { themeId, transparent }: DiagramLook): Promise<void> {
    try {
        checkClipboard()
        // Pasted into other apps, like a saved .svg file (see exportSvg).
        const svg = buildExportSvg(source, themeId, { labelHalo: false, transparent })
        const formats: Record<string, Blob> = { 'text/plain': new Blob([svg], { type: 'text/plain' }) }
        if (ClipboardItem.supports?.('image/svg+xml')) {
            formats['image/svg+xml'] = new Blob([svg], { type: 'image/svg+xml' })
        }
        await writeClipboard(formats)
        notifySuccess('Diagram copied as SVG')
    } catch (err) {
        notifyError(COPY_FAILED, err)
    }
}
