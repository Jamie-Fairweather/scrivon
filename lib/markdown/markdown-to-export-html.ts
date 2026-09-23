import type { Element, Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Code, Parent, Root, Text } from 'mdast'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { buildExportDocument, type BuildExportDocumentOptions, type ExportDocument } from '@/lib/markdown/export-document'
import { buildPdfExportCss, PDF_PAGE_NUMBER_MARK, pdfTocMark, resolvePdfExportLayout, resolvePdfPrintOptions } from '@/lib/markdown/export-html-css'
import { pdfPageNumberTemplate, resolvePdfChromeText } from '@/lib/markdown/export-metadata'
import type { PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { highlightFencedCode } from '@/lib/markdown/shiki-highlighter'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import type { PdfExportDocument, PdfExportMetadata, PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

export type MarkdownToExportHtmlOptions = BuildExportDocumentOptions

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function normalizeShikiPre(html: string): string {
    return html.replace(/\s*tabindex="0"/g, '')
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Hidden mark inside each TOC-listed heading so the PDF stamper can read which page it landed on. */
function addHeadingMarks(hast: HastRoot, items: PdfExportOutlineItem[]): void {
    if (items.length === 0) return
    const markById = new Map(items.map((item, index) => [item.id, pdfTocMark(index, 'heading')]))
    visit(hast, 'element', (node: Element) => {
        if (!HEADING_TAGS.has(node.tagName)) return
        const mark = typeof node.properties.id === 'string' ? markById.get(node.properties.id) : undefined
        if (!mark) return
        node.children.unshift({
            type: 'element',
            tagName: 'span',
            properties: { className: ['pdf-heading-mark'] },
            children: [{ type: 'text', value: mark }],
        })
    })
}

async function codeBlockToHtml(node: Code, profile: PdfExportProfile): Promise<string> {
    const text = node.value.replace(/\n$/, '')
    const lang = node.lang?.toLowerCase()

    if (lang === 'mermaid') {
        try {
            const svg = renderMermaidDiagramForExport(text, profile.content.mermaidThemeId)
            return `<div class="mermaid-export pdf-avoid-break">${svg}</div>`
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return `<pre class="export-error pdf-avoid-break">${escapeHtml(message)}</pre>`
        }
    }

    try {
        const highlighted = normalizeShikiPre(await highlightFencedCode(text, lang, profile.content.codeTheme))
        return `<div class="code-block pdf-avoid-break">${highlighted}</div>`
    } catch {
        return `<div class="code-block pdf-avoid-break"><pre><code>${escapeHtml(text)}</code></pre></div>`
    }
}

async function transformCodeBlocks(tree: Root, profile: PdfExportProfile): Promise<Map<string, string>> {
    const exportId = crypto.randomUUID()
    const placeholders = new Map<string, string>()
    const replacements: { parent: Parent; index: number; promise: Promise<string> }[] = []

    visit(tree, 'code', (node: Code, index, parent) => {
        replacements.push({
            parent: parent as Parent,
            index: index as number,
            promise: codeBlockToHtml(node, profile),
        })
    })

    const htmlFragments = await Promise.all(replacements.map((r) => r.promise))
    replacements.forEach((r, i) => {
        const key = `__SCRIVON_${exportId}_BLOCK_${i}__`
        placeholders.set(key, htmlFragments[i]!)
        r.parent.children[r.index] = {
            type: 'paragraph',
            children: [{ type: 'text', value: key } satisfies Text],
        }
    })

    return placeholders
}

function renderTitlePage(metadata: PdfExportMetadata, assets: PdfExportResolvedAssets): string {
    const logo = assets.logoDataUrl ? `<img class="pdf-logo" src="${escapeHtml(assets.logoDataUrl)}" alt="" />` : ''
    const subtitle = metadata.subtitle ? `<p class="pdf-title-meta">${escapeHtml(metadata.subtitle)}</p>` : ''
    const author = metadata.author ? `<p class="pdf-title-meta">${escapeHtml(metadata.author)}</p>` : ''
    const date = metadata.date ? `<p class="pdf-title-meta">${escapeHtml(metadata.date)}</p>` : ''
    return `<section class="pdf-title-page">${logo}<div class="pdf-title-body"><h1>${escapeHtml(metadata.title)}</h1>${subtitle}${author}${date}</div></section>`
}

function renderToc(items: PdfExportOutlineItem[]): string {
    if (items.length === 0) return ''
    const list = items
        .map((item, index) => {
            const level = Math.min(item.level, 4)
            return `<li class="pdf-toc-l${level}"><a href="#${escapeHtml(item.id)}"><span class="pdf-toc-title">${escapeHtml(item.text)}</span><span class="pdf-toc-leader"></span><span class="pdf-toc-num"><span class="pdf-toc-mark">${pdfTocMark(index, 'slot')}</span></span></a></li>`
        })
        .join('')
    return `<section class="pdf-toc-page"><h1>Contents</h1><ol class="pdf-toc-list">${list}</ol></section>`
}

function chromeImage(dataUrl: string): string {
    return dataUrl ? `<img src="${escapeHtml(dataUrl)}" alt="" />` : ''
}

function chromeLabel(text: string, metadata: PdfExportMetadata): string {
    const resolved = resolvePdfChromeText(text, metadata)
    return resolved ? `<span>${escapeHtml(resolved)}</span>` : ''
}

/** The footer's right-hand text: a page counter slot for the stamper, or plain text. */
function footerRightText(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    const format = profile.footer.pageNumbers
    if (format === 'none') return ''
    if (format === 'custom' && !pdfPageNumberTemplate(profile, metadata)) {
        return chromeLabel(profile.footer.right.text, metadata)
    }
    return `<span class="pdf-page-number"><span class="pdf-page-number-mark">${PDF_PAGE_NUMBER_MARK}</span></span>`
}

/**
 * Header/footer bar: `[image][text] … [text][image]`, so an image on either
 * end is always the outermost item, nearest the page edge.
 */
function renderChromeCell(
    kind: 'header' | 'footer',
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata
): string {
    const chrome = kind === 'header' ? profile.header : profile.footer
    const images = kind === 'header' ? assets.header : assets.footer
    const rightText = kind === 'header' ? chromeLabel(chrome.right.text, metadata) : footerRightText(profile, metadata)
    return `<div class="pdf-chrome-bar pdf-${kind}-bar"><span class="pdf-chrome-side pdf-chrome-left">${chromeImage(images.left)}${chromeLabel(chrome.left.text, metadata)}</span><span class="pdf-chrome-side pdf-chrome-right">${rightText}${chromeImage(images.right)}</span></div>`
}

/**
 * One table per section (title, TOC, body). The repeating header/footer rows
 * give every page of a section its chrome and, in bleed mode, its margins,
 * while the CSS hide rules can still switch the bars off per section.
 */
function chromeTable(
    kind: 'title' | 'toc' | 'body',
    inner: string,
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata
): string {
    return `<table class="pdf-chrome-table pdf-${kind}-table">
    <thead class="pdf-chrome-head"><tr><td>${renderChromeCell('header', profile, assets, metadata)}</td></tr></thead>
    <tbody><tr><td>${inner}</td></tr></tbody>
    <tfoot><tr><td>${renderChromeCell('footer', profile, assets, metadata)}</td></tr></tfoot>
  </table>`
}

function wrapWithChrome(
    titlePageHtml: string,
    tocHtml: string,
    bodyHtml: string,
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata
): string {
    const body = `<div class="pdf-body">${bodyHtml}</div>`
    const layout = resolvePdfExportLayout(profile)
    // In bleed mode the repeating table rows also supply the page margins, so tables are always needed.
    const needsChrome = layout.showHeader || layout.showFooter || layout.bleed
    if (!needsChrome) {
        return `<article class="export-article">${titlePageHtml}${tocHtml}${body}</article>`
    }

    const sections = [
        titlePageHtml ? chromeTable('title', titlePageHtml, profile, assets, metadata) : '',
        tocHtml ? chromeTable('toc', tocHtml, profile, assets, metadata) : '',
        chromeTable('body', body, profile, assets, metadata),
    ]
    return `<article class="export-article">
  ${sections.filter(Boolean).join('\n  ')}
</article>`
}

/**
 * Markdown + profile (+ overrides) → the branded, self-contained HTML document
 * and the print settings that must accompany it. Throws `Nothing to export.`
 * when the body is empty after front matter is removed.
 */
export async function markdownToExportHtml(source: string, options: MarkdownToExportHtmlOptions = {}): Promise<PdfExportDocument> {
    return renderExportPdf(buildExportDocument(source, options))
}

/** PDF renderer for an {@link ExportDocument}. Replaces fenced code in `tree` with HTML placeholders. */
export async function renderExportPdf(document: ExportDocument): Promise<PdfExportDocument> {
    const { profile, assets, metadata, tree, toc: tocItems } = document
    const placeholders = await transformCodeBlocks(tree, profile)

    const hast = unified().use(remarkRehype, { allowDangerousHtml: false }).runSync(tree) as HastRoot
    addHeadingMarks(hast, tocItems)
    let bodyHtml = toHtml(hast, { allowDangerousHtml: false })

    for (const [key, html] of placeholders) {
        bodyHtml = bodyHtml.split(key).join(html)
    }

    const titlePage = profile.frontMatter.titlePage ? renderTitlePage(metadata, assets) : ''
    const toc = renderToc(tocItems)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(metadata.title)}</title>
  <style>${buildPdfExportCss(profile)}</style>
</head>
<body>
  ${wrapWithChrome(titlePage, toc, bodyHtml, profile, assets, metadata)}
</body>
</html>`

    return { html, metadata, print: resolvePdfPrintOptions(profile, metadata) }
}
