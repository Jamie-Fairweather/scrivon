import { invoke } from '@tauri-apps/api/core'
import { buildExportDocument, type ExportFormat } from '@/lib/markdown/export-document'
import { resolvePdfExportAssets } from '@/lib/markdown/export-assets'
import { markdownToExportHtml } from '@/lib/markdown/markdown-to-export-html'
import { errorMessage, notifyError } from '@/lib/notify'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportDocument, PdfExportMetadataOverrides, PdfExportProfile, PdfPrintOptions } from '@/lib/settings/pdf-export-types'
import { pickSavePath, writeBinaryFile } from '@/lib/tauri/dialog'
import { isTauri, isWindowsTauri } from '@/lib/tauri/platform'

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_FILTERS = [{ name: 'Word document', extensions: ['docx'] }]

export type ExportMarkdownOptions = {
    format?: ExportFormat
    profile?: PdfExportProfile
    overrides?: PdfExportMetadataOverrides
}

export type ExportMarkdownToPdfOptions = ExportMarkdownOptions

/** How an export ended: saved (or handed to the print dialog / a download), cancelled at the save picker, or failed. */
export type ExportResult = { status: 'saved'; path?: string } | { status: 'cancelled' } | { status: 'failed'; message: string }

export function markdownExportBaseName(tabName: string | undefined): string {
    if (!tabName) return 'document'
    const base = tabName.replace(/\.md$/i, '')
    return base || 'document'
}

function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
}

async function printExportHtml(html: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe')
        iframe.setAttribute('aria-hidden', 'true')
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:0;border:0;'

        const cleanup = () => {
            iframe.remove()
        }

        iframe.addEventListener(
            'load',
            () => {
                void (async () => {
                    try {
                        const doc = iframe.contentDocument
                        const win = iframe.contentWindow
                        const article = doc?.querySelector('.export-article')
                        if (!win || !doc?.body || !article?.innerHTML.trim()) {
                            throw new Error('Export document is empty.')
                        }

                        if (doc.fonts?.ready) {
                            await doc.fonts.ready
                        }
                        await waitForPaint()

                        const onAfterPrint = () => {
                            win.removeEventListener('afterprint', onAfterPrint)
                            cleanup()
                            resolve()
                        }

                        win.addEventListener('afterprint', onAfterPrint)
                        win.focus()
                        win.print()
                    } catch (err) {
                        cleanup()
                        reject(err)
                    }
                })()
            },
            { once: true }
        )

        iframe.srcdoc = html
        document.body.appendChild(iframe)
    })
}

async function savePdfWithWebView2(html: string, outputPath: string, options: PdfPrintOptions): Promise<void> {
    await invoke('export_html_to_pdf', { html, outputPath, options })
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

async function saveDocx(bytes: Uint8Array, filename: string): Promise<ExportResult> {
    if (isTauri()) {
        const path = await pickSavePath({ title: 'Save Word document', defaultPath: filename, filters: DOCX_FILTERS })
        if (!path) return { status: 'cancelled' }
        await writeBinaryFile(path, bytes)
        return { status: 'saved', path }
    }

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    triggerBrowserDownload(new Blob([copy], { type: DOCX_MIME }), filename)
    return { status: 'saved' }
}

/** Resolves the profile's images, then builds the document the export and preview paths share. */
export async function buildMarkdownExportHtml(
    source: string,
    tabName: string | undefined,
    options: ExportMarkdownOptions = {}
): Promise<PdfExportDocument> {
    const profile = options.profile ?? createDefaultPdfExportProfile()
    const assets = await resolvePdfExportAssets(profile)
    return markdownToExportHtml(source, { profile, tabName, overrides: options.overrides, assets })
}

/**
 * Builds the document and saves it. Never throws and shows nothing itself: the result
 * tells the caller whether it was saved, cancelled at the save picker, or failed (and why).
 */
export async function exportMarkdown(source: string, tabName: string | undefined, options: ExportMarkdownOptions = {}): Promise<ExportResult> {
    try {
        if (options.format === 'docx') {
            const profile = options.profile ?? createDefaultPdfExportProfile()
            const assets = await resolvePdfExportAssets(profile)
            const document = buildExportDocument(source, { profile, tabName, overrides: options.overrides, assets })
            const { renderExportDocx } = await import('@/lib/markdown/export-docx')
            const bytes = await renderExportDocx(document)
            return await saveDocx(bytes, `${markdownExportBaseName(tabName)}.docx`)
        }

        const { html, print } = await buildMarkdownExportHtml(source, tabName, options)
        const filename = `${markdownExportBaseName(tabName)}.pdf`

        if (isWindowsTauri()) {
            const path = await pickSavePath({ title: 'Save PDF', defaultPath: filename, filters: PDF_FILTERS })
            if (!path) return { status: 'cancelled' }
            await savePdfWithWebView2(html, path, print)
            return { status: 'saved', path }
        }

        await printExportHtml(html)
        return { status: 'saved' }
    } catch (err) {
        return { status: 'failed', message: errorMessage(err, 'The export could not be created.') }
    }
}

/** {@link exportMarkdown} that tells the user when the export fails. */
export async function exportMarkdownToPdf(source: string, tabName: string | undefined, options: ExportMarkdownOptions = {}): Promise<ExportResult> {
    const result = await exportMarkdown(source, tabName, options)
    if (result.status === 'failed') notifyError('Export failed', undefined, { description: result.message })
    return result
}
