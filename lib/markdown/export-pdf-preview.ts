import { invoke } from '@tauri-apps/api/core'
import { buildExportPdfPage, describeLeftOut } from '@/lib/markdown/export-pdf'
import type { PdfExportMetadataOverrides, PdfExportProfile } from '@/lib/settings/pdf-export-types'

export type PdfPreviewOptions = {
    profile: PdfExportProfile
    overrides?: PdfExportMetadataOverrides
    /** The document's file path, so its images are found from it. */
    documentPath?: string
    /** The open folder. Only images inside it are shown. */
    workspaceRoot?: string | null
    /** The user chose to load this document's web images in the preview, so the PDF shows them too. */
    allowRemoteImages?: boolean
}

/** A preview of the PDF export, and what it had to leave out, if anything. */
export type PdfPreview = { pdf: Blob; note?: string }

/** What `preview_html_pdf` sends back: the numbered PDF as base64. */
type PreviewReply = { pdf: string; pageNumberWarning: string | null }

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
}

/**
 * Makes the PDF a Windows export would save, page numbers included, without asking where to
 * save it. The app prints it to a temporary file and deletes that once it has sent it back.
 * Throws when the document or the print fails.
 */
export async function previewMarkdownPdf(source: string, tabName: string | undefined, options: PdfPreviewOptions): Promise<PdfPreview> {
    const { html, print, ...leftOut } = await buildExportPdfPage(source, tabName, { ...options, stamped: true })
    const reply = await invoke<PreviewReply>('preview_html_pdf', { html, options: print })
    const pdf = new Blob([base64ToBytes(reply.pdf)], { type: 'application/pdf' })
    const note = describeLeftOut({ pageNumberWarning: reply.pageNumberWarning ?? undefined, ...leftOut })
    return note ? { pdf, note } : { pdf }
}
