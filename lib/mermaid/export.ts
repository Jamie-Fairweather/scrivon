import { getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'
import { pickSavePath, showError, writeBinaryFile, writeTextFileAtPath } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

export type PngExportScale = 1 | 2 | 4

export function exportBaseName(tabName: string | undefined): string {
    if (!tabName) return 'diagram'
    const base = tabName.replace(/\.(mmd|mermaid)$/i, '')
    return base || 'diagram'
}

export function buildExportSvg(source: string, themeId: AppThemeId): string {
    const trimmed = source.trim()
    if (!trimmed) {
        throw new Error('Nothing to export.')
    }
    return renderMermaidDiagramForExport(trimmed, themeId)
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

async function saveBytes(bytes: Uint8Array, filename: string, mimeType: string, filters: { name: string; extensions: string[] }[]): Promise<void> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: filename, filters })
        if (!path) return
        await writeBinaryFile(path, bytes)
        return
    }

    triggerBrowserDownload(new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename)
}

async function saveText(content: string, filename: string, filters: { name: string; extensions: string[] }[]): Promise<void> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save diagram', defaultPath: filename, filters })
        if (!path) return
        await writeTextFileAtPath(path, content)
        return
    }

    triggerBrowserDownload(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

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
            else reject(new Error('Failed to encode PNG.'))
        }, 'image/png')
    })
}

export async function svgToPngBlob(svg: string, themeId: AppThemeId, scale: PngExportScale): Promise<Blob> {
    const dims = getSvgDimensions(svg)
    if (!dims) {
        throw new Error('Could not determine diagram dimensions.')
    }

    const width = Math.round(dims.width * scale)
    const height = Math.round(dims.height * scale)
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

export async function exportSvg(source: string, themeId: AppThemeId, tabName: string | undefined): Promise<void> {
    try {
        const svg = buildExportSvg(source, themeId)
        const filename = `${exportBaseName(tabName)}.svg`
        await saveText(svg, filename, SVG_FILTERS)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await showError('Export failed', message)
    }
}

export async function exportPng(source: string, themeId: AppThemeId, tabName: string | undefined, scale: PngExportScale): Promise<void> {
    try {
        const svg = buildExportSvg(source, themeId)
        const blob = await svgToPngBlob(svg, themeId, scale)
        const filename = `${exportBaseName(tabName)}.png`
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await saveBytes(bytes, filename, 'image/png', PNG_FILTERS)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await showError('Export failed', message)
    }
}
