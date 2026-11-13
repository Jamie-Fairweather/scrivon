import { invoke } from '@tauri-apps/api/core'
import { buildExportDocument, type ExportDocument, type ExportFormat } from '@/lib/markdown/export-document'
import { resolvePdfExportAssets, type PdfExportMissingImage } from '@/lib/markdown/export-assets'
import { renderExportPdf } from '@/lib/markdown/markdown-to-export-html'
import { errorMessage, notifyInfo, notifyWarning } from '@/lib/notify'
import { downloadBlob } from '@/lib/download'
import { saveExportHtml } from '@/lib/markdown/export-html'
import { notifyFileSaved, showInFolderAction } from '@/lib/saved-file-notice'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportMetadataOverrides, PdfExportProfile, PdfPrintOptions } from '@/lib/settings/pdf-export-types'
import { pickSavePath, writeBinaryFile } from '@/lib/tauri/dialog'
import { getBaseName } from '@/lib/tauri/fs'
import { isTauri, isWindowsTauri } from '@/lib/tauri/platform'
import { savePathBesideDocument } from '@/lib/tauri/save-path'

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_FILTERS = [{ name: 'Word document', extensions: ['docx'] }]
/** How long the print path waits for `afterprint` once print() has returned. */
const AFTER_PRINT_GRACE_MS = 1_500

export type ExportMarkdownOptions = {
    format?: ExportFormat
    profile?: PdfExportProfile
    overrides?: PdfExportMetadataOverrides
    /** The document's file path, so the save dialog starts in its folder. */
    documentPath?: string
    /** The user chose to load this document's web images in the preview, so the PDF and HTML show them too. Word ignores it. */
    allowRemoteImages?: boolean
}

/** A saved export (or one handed to the print dialog / a download), with anything it had to leave out. */
export type SavedExport = {
    status: 'saved'
    path?: string
    missingImages?: PdfExportMissingImage[]
    /** Why the PDF was saved without its page numbers (the Windows app adds them after printing). */
    pageNumberWarning?: string
    /** The profile asks for a table of contents, but no heading matched its settings, so there is none. */
    tocSkipped?: boolean
}

/** How an export ended: saved, cancelled at the save picker, or failed. */
export type ExportResult = SavedExport | { status: 'cancelled' } | { status: 'failed'; message: string }

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
        // The export page runs no scripts. Same-origin only so its document can be read; modals so it can print.
        iframe.setAttribute('sandbox', 'allow-same-origin allow-modals')
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:0;border:0;'

        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        // Settles once, on whichever comes first: afterprint, the grace period after print(), or an error.
        const finish = (settle: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            iframe.remove()
            settle()
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

                        win.addEventListener('afterprint', () => finish(resolve), { once: true })
                        win.focus()
                        win.print()
                        // print() blocks until the dialog closes in most engines, but some webviews
                        // never send afterprint (or print nothing at all), so don't wait on it forever.
                        if (!settled) timer = setTimeout(() => finish(resolve), AFTER_PRINT_GRACE_MS)
                    } catch (err) {
                        finish(() => reject(err))
                    }
                })()
            },
            { once: true }
        )

        iframe.srcdoc = html
        document.body.appendChild(iframe)
    })
}

/** Saves the PDF. Returns why, when it was saved but its page numbers couldn't be added. */
async function savePdfWithWebView2(html: string, outputPath: string, options: PdfPrintOptions): Promise<string | undefined> {
    const pageNumberProblem = await invoke<string | null>('export_html_to_pdf', { html, outputPath, options })
    return pageNumberProblem || undefined
}

async function saveDocx(bytes: Uint8Array, filename: string, documentPath: string | undefined): Promise<ExportResult> {
    if (isTauri()) {
        const path = await pickSavePath({
            title: 'Save Word document',
            defaultPath: savePathBesideDocument(filename, documentPath),
            filters: DOCX_FILTERS,
        })
        if (!path) return { status: 'cancelled' }
        await writeBinaryFile(path, bytes)
        return { status: 'saved', path }
    }

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    downloadBlob(new Blob([copy], { type: DOCX_MIME }), filename)
    return { status: 'saved' }
}

/** What an export had to leave out. */
type LeftOut = { missingImages: PdfExportMissingImage[]; tocSkipped: boolean }

type DocumentOptions = { profile: PdfExportProfile; overrides?: PdfExportMetadataOverrides }

/** The steps both formats share: the profile's images, then the document. */
async function prepareExport(
    source: string,
    tabName: string | undefined,
    { profile, overrides }: DocumentOptions
): Promise<LeftOut & { exportDocument: ExportDocument }> {
    const { assets, missing } = await resolvePdfExportAssets(profile)
    const exportDocument = buildExportDocument(source, { profile, tabName, overrides, assets })
    // Both renderers leave the contents page out when no heading matches the TOC settings.
    const tocSkipped = profile.frontMatter.toc && exportDocument.toc.length === 0
    return { exportDocument, missingImages: missing, tocSkipped }
}

export type ExportPdfPageOptions = DocumentOptions & {
    /** The user chose to load this document's web images in the preview, so the PDF prints them too. */
    allowRemoteImages?: boolean
    /** Leave marks for the Windows exporter to stamp page numbers on, instead of CSS page counters. */
    stamped: boolean
}

/** The page a PDF is printed from, its print settings, and what it had to leave out. */
export type ExportPdfPage = LeftOut & { html: string; print: PdfPrintOptions }

/**
 * Builds the page a PDF export prints. The export dialog's preview uses it too,
 * so the preview always shows what the export would save.
 */
export async function buildExportPdfPage(source: string, tabName: string | undefined, options: ExportPdfPageOptions): Promise<ExportPdfPage> {
    const { exportDocument, ...leftOut } = await prepareExport(source, tabName, options)
    const { html, print } = await renderExportPdf(exportDocument, { stamped: options.stamped, allowRemoteImages: options.allowRemoteImages === true })
    return { html, print, ...leftOut }
}

async function exportDocx(source: string, tabName: string | undefined, options: ExportMarkdownOptions & DocumentOptions) {
    const { exportDocument, ...leftOut } = await prepareExport(source, tabName, options)
    const { renderExportDocx } = await import('@/lib/markdown/export-docx')
    const bytes = await renderExportDocx(exportDocument)
    return { ...leftOut, result: await saveDocx(bytes, `${markdownExportBaseName(tabName)}.docx`, options.documentPath) }
}

async function exportHtml(source: string, tabName: string | undefined, options: ExportMarkdownOptions & DocumentOptions) {
    const { exportDocument, ...leftOut } = await prepareExport(source, tabName, options)
    const { documentPath, allowRemoteImages = false } = options
    return { ...leftOut, result: await saveExportHtml(exportDocument, markdownExportBaseName(tabName), { documentPath, allowRemoteImages }) }
}

async function exportPdf(source: string, tabName: string | undefined, options: ExportMarkdownOptions & DocumentOptions) {
    // Only the Windows exporter stamps page numbers; the system print dialog gets CSS page counters instead.
    const stamped = isWindowsTauri()
    const { html, print, ...leftOut } = await buildExportPdfPage(source, tabName, { ...options, stamped })
    return { ...leftOut, result: await savePdf(html, print, tabName, options.documentPath, stamped) }
}

async function savePdf(
    html: string,
    print: PdfPrintOptions,
    tabName: string | undefined,
    documentPath: string | undefined,
    stamped: boolean
): Promise<ExportResult> {
    if (stamped) {
        const filename = `${markdownExportBaseName(tabName)}.pdf`
        const path = await pickSavePath({ title: 'Save PDF', defaultPath: savePathBesideDocument(filename, documentPath), filters: PDF_FILTERS })
        if (!path) return { status: 'cancelled' }
        const pageNumberWarning = await savePdfWithWebView2(html, path, print)
        return pageNumberWarning ? { status: 'saved', path, pageNumberWarning } : { status: 'saved', path }
    }

    await printExportHtml(html)
    return { status: 'saved' }
}

const EXPORTERS = { pdf: exportPdf, docx: exportDocx, html: exportHtml } satisfies Record<ExportFormat, unknown>

/**
 * Builds the document and saves it. Never throws and shows nothing itself: the result
 * tells the caller whether it was saved, cancelled at the save picker, or failed (and why).
 */
export async function exportMarkdown(source: string, tabName: string | undefined, options: ExportMarkdownOptions = {}): Promise<ExportResult> {
    try {
        const profile = options.profile ?? createDefaultPdfExportProfile()
        const save = EXPORTERS[options.format ?? 'pdf']
        const { result, missingImages, tocSkipped } = await save(source, tabName, { ...options, profile })
        // Nothing was saved, so there is nothing to report.
        if (result.status !== 'saved') return result
        return { ...result, ...(missingImages.length > 0 ? { missingImages } : {}), ...(tocSkipped ? { tocSkipped } : {}) }
    } catch (err) {
        return { status: 'failed', message: errorMessage(err, 'The export could not be created.') }
    }
}

function describeMissingImages(missing: PdfExportMissingImage[]): string {
    return missing.map(({ slot, path, reason }) => `${slot} (${getBaseName(path)}): ${reason}`).join('; ')
}

const TOC_SKIPPED = 'No headings matched the table of contents settings, so no contents page was added.'

/** The non-empty parts as one description, each ending in a full stop when another follows. */
function joinSentences(parts: (string | undefined)[]): string {
    const kept = parts.filter((part): part is string => Boolean(part))
    return kept.map((part, index) => (index < kept.length - 1 && !/[.!?]$/.test(part) ? `${part}.` : part)).join(' ')
}

/** What a PDF had to leave out (page numbers, profile images, the contents page), as one note; empty when nothing. */
export function describeLeftOut({ pageNumberWarning, missingImages = [], tocSkipped }: Omit<SavedExport, 'status' | 'path'>): string {
    const images = missingImages.length > 0 ? ['Some images were left out', describeMissingImages(missingImages)] : []
    return joinSentences([pageNumberWarning, ...images, tocSkipped ? TOC_SKIPPED : ''])
}

/**
 * Tells the user the export was saved and where, with a button that shows the file in its
 * folder. One notice says what had to be left out (page numbers, profile images, or both),
 * and when no heading matched the table of contents settings.
 */
export function notifyExportSaved({ path, missingImages = [], pageNumberWarning, tocSkipped }: SavedExport): void {
    const images = missingImages.length > 0 ? describeMissingImages(missingImages) : ''
    const toc = tocSkipped ? TOC_SKIPPED : ''
    if (!path) {
        // The print dialog or the browser's download took over; only what was left out needs a word.
        if (images) notifyWarning('Some images were left out', { description: joinSentences([images, toc]) })
        else if (toc) notifyInfo('No contents page was added', { description: toc })
        return
    }
    const leftOut = [pageNumberWarning ? 'page numbers' : '', images ? 'some images' : ''].filter(Boolean)
    if (leftOut.length > 0) {
        const description = joinSentences([pageNumberWarning, images, toc])
        notifyWarning(`Saved ${getBaseName(path)} without ${leftOut.join(' or ')}`, { description, action: showInFolderAction(path) })
        return
    }
    // The title names the file and Show in folder finds it, so the TOC note can take the path's place.
    notifyFileSaved(path, toc || path)
}
