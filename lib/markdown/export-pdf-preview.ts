import { invoke } from '@tauri-apps/api/core'
import { resolvePdfExportAssets } from '@/lib/markdown/export-assets'
import { buildExportDocument } from '@/lib/markdown/export-document'
import { renderExportPdf } from '@/lib/markdown/markdown-to-export-html'
import type { PdfExportMetadataOverrides, PdfExportProfile } from '@/lib/settings/pdf-export-types'

export type PdfPreviewOptions = {
    profile: PdfExportProfile
    overrides?: PdfExportMetadataOverrides
    /** The user chose to load this document's web images in the preview, so the PDF shows them too. */
    allowRemoteImages?: boolean
}

/** A preview of the PDF export, and why its page numbers were left out, if they were. */
export type PdfPreview = { pdf: Blob; pageNumberWarning?: string }

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
    const { profile, overrides, allowRemoteImages = false } = options
    const { assets } = await resolvePdfExportAssets(profile)
    const exportDocument = buildExportDocument(source, { profile, tabName, overrides, assets })
    const { html, print } = await renderExportPdf(exportDocument, { stamped: true, allowRemoteImages })
    const reply = await invoke<PreviewReply>('preview_html_pdf', { html, options: print })
    const pdf = new Blob([base64ToBytes(reply.pdf)], { type: 'application/pdf' })
    return reply.pageNumberWarning ? { pdf, pageNumberWarning: reply.pageNumberWarning } : { pdf }
}
