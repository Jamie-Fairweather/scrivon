import { getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'
import { notifyError, notifyWarning } from '@/lib/notify'
import { pickSavePath, writeBinaryFile, writeTextFileAtPath } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import { flattenSvgForExport } from '@/lib/mermaid/flatten-svg'
import { renderMermaidDiagramForExport, type ExportRenderOptions } from '@/lib/mermaid/render'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

export type PngExportScale = 1 | 2 | 4

/** Where a diagram being exported comes from. */
export type DiagramExportTarget = {
    /** The tab's name, e.g. 'flow.mmd', or 'notes.md' for a diagram expanded from Markdown. */
    tabName?: string
    /** The document's path on disk. The save dialog opens in its folder. */
    tabPath?: string
    /** For a diagram expanded from Markdown: the document's text, used to number its diagrams. */
    markdown?: string
}

// Characters Windows does not allow in file names, including control characters.
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]+/g
const RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Turns a tab name into a file name Windows accepts. Example titles such as 'CI/CD Pipeline' or
 * 'Inheritance (<|--)' would otherwise be split into folders or rejected by the save dialog.
 */
export function safeFileStem(name: string, fallback: string): string {
    const stem = name
        .replace(INVALID_FILE_NAME_CHARS, '-')
        .replace(/-{2,}/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.-]+|[\s.-]+$/g, '')
    if (!stem) return fallback
    return RESERVED_FILE_NAME.test(stem) ? `${stem}_` : stem
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

/** Suggests saving next to the document. Example and unsaved tabs have no folder, so they get the bare name. */
export function savePathBesideDocument(fileName: string, documentPath: string | undefined): string {
    if (!documentPath || !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(documentPath)) return fileName
    const slash = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'))
    return `${documentPath.slice(0, slash + 1)}${fileName}`
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

function triggerBrowserDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}

type SaveFilters = { name: string; extensions: string[] }[]

/** Returns false when the user cancels the save dialog. */
async function saveBytes(
    bytes: Uint8Array,
    filename: string,
    documentPath: string | undefined,
    mimeType: string,
    filters: SaveFilters
): Promise<boolean> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: savePathBesideDocument(filename, documentPath), filters })
        if (!path) return false
        await writeBinaryFile(path, bytes)
        return true
    }

    triggerBrowserDownload(new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename)
    return true
}

async function saveText(content: string, filename: string, documentPath: string | undefined, filters: SaveFilters): Promise<void> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: savePathBesideDocument(filename, documentPath), filters })
        if (!path) return
        await writeTextFileAtPath(path, content)
        return
    }

    triggerBrowserDownload(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }), filename)
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

/** Draws the SVG to a PNG at `scale`, or smaller if that would be too big for a canvas (see fitPngScale). */
export async function svgToPngBlob(svg: string, themeId: AppThemeId, scale: number): Promise<Blob> {
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

    const bg = getDiagramColors(themeId).bg
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    return canvasToPngBlob(canvas)
}

const SVG_FILTERS = [{ name: 'SVG', extensions: ['svg'] }]
const PNG_FILTERS = [{ name: 'PNG', extensions: ['png'] }]

export async function exportSvg(source: string, themeId: AppThemeId, target: DiagramExportTarget): Promise<void> {
    try {
        // Other apps open this file, and some would hide halo'd labels (see ExportRenderOptions).
        const svg = buildExportSvg(source, themeId, { labelHalo: false })
        const filename = `${diagramFileStem(source, target)}.svg`
        await saveText(svg, filename, target.tabPath, SVG_FILTERS)
    } catch (err) {
        notifyError('Export failed', err)
    }
}

export async function exportPng(source: string, themeId: AppThemeId, target: DiagramExportTarget, scale: PngExportScale): Promise<void> {
    try {
        const svg = buildExportSvg(source, themeId)
        const dims = getSvgDimensions(svg)
        if (!dims) {
            throw new Error('Could not determine diagram dimensions.')
        }

        // Shrink to fit rather than fail, but not so far that the labels can't be read.
        const drawScale = fitPngScale(dims, scale)
        if (drawScale < MIN_PNG_SCALE) {
            throw new Error(PNG_TOO_LARGE_MESSAGE)
        }

        const blob = await svgToPngBlob(svg, themeId, drawScale)
        const filename = `${diagramFileStem(source, target)}.png`
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const saved = await saveBytes(bytes, filename, target.tabPath, 'image/png', PNG_FILTERS)

        if (saved && drawScale < scale) {
            const size = `${Math.round(dims.width * drawScale)} × ${Math.round(dims.height * drawScale)} px`
            notifyWarning('Saved a smaller PNG', { description: `This diagram is too big for ${scale}×, so it was saved at ${size}.` })
        }
    } catch (err) {
        notifyError('Export failed', err)
    }
}
