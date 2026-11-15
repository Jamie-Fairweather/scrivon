import { downloadBlob } from '@/lib/download'
import type { ExportDocument } from '@/lib/markdown/export-document'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import { renderExportPdf } from '@/lib/markdown/markdown-to-export-html'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { pickSavePath, writeTextFileAtPath } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import { savePathBesideDocument } from '@/lib/tauri/save-path'

const HTML_FILTERS = [{ name: 'Web page', extensions: ['html', 'htm'] }]

export type HtmlRenderOptions = {
    /** The user chose to load this document's web images in the preview, so the page shows them too. */
    allowRemoteImages?: boolean
}

/** A web page has no pages: no header, footer or page numbers, and no cover image reaching the paper's edge. */
function screenProfile(profile: PdfExportProfile): PdfExportProfile {
    return {
        ...profile,
        header: { ...profile.header, enabled: false },
        footer: { ...profile.footer, enabled: false, pageNumbers: 'none' },
        brand: { ...profile.brand, logoIgnoreMargins: false },
    }
}

/** On screen the text sits in a readable column. Printing the page still uses the PDF's page layout. */
const SCREEN_CSS = `@media screen {
    body { padding: 2.5rem 1.25rem; }
    .export-article { max-width: 48rem; margin: 0 auto; }
    .pdf-title-page { min-height: 0; max-height: none; padding: 2rem 0; }
    .pdf-title-page, .pdf-toc-page { margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid #e5e5e5; }
  }`

function escapeAttribute(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A `<meta>` line for the page's details, or nothing when the value is empty. */
function metaTag(name: string, value: string): string {
    const text = value.trim()
    return text ? `  <meta name="${name}" content="${escapeAttribute(text)}" />\n` : ''
}

/** The web page, and how many diagrams it shows as a note or an error instead of a picture. */
export type ExportHtmlPage = { html: string; diagramsNotDrawn: number }

/**
 * The document as one web page that needs no other files: its styles are inline and its
 * diagrams are drawn in as SVG. Built from the same page as the PDF, so it looks the same,
 * except that each `<details>` stays closed as written, since a web page can be clicked.
 */
export async function renderExportHtml(document: ExportDocument, { allowRemoteImages = false }: HtmlRenderOptions = {}): Promise<ExportHtmlPage> {
    const { metadata } = document
    const { html, diagramsNotDrawn } = await renderExportPdf(
        { ...document, profile: screenProfile(document.profile) },
        { stamped: false, allowRemoteImages, openDetails: false }
    )
    const head = `  <meta name="viewport" content="width=device-width, initial-scale=1" />
${metaTag('author', metadata.author)}${metaTag('description', metadata.subtitle)}  <style>${SCREEN_CSS}</style>
</head>`
    // A function, so a `$` in the author or subtitle is kept as typed (a string would read `$&` and `$'` as patterns).
    return { html: html.replace('</head>', () => head), diagramsNotDrawn }
}

/**
 * Saves the page as `<fileStem>.html`, offering the document's folder first.
 * Outside the desktop app it downloads instead. Throws when the file can't be written.
 */
export async function saveExportHtml(html: string, fileStem: string, { documentPath }: { documentPath?: string }): Promise<ExportResult> {
    const filename = `${fileStem}.html`
    if (!isTauri()) {
        downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename)
        return { status: 'saved' }
    }
    const path = await pickSavePath({ title: 'Save HTML', defaultPath: savePathBesideDocument(filename, documentPath), filters: HTML_FILTERS })
    if (!path) return { status: 'cancelled' }
    await writeTextFileAtPath(path, html)
    return { status: 'saved', path }
}
