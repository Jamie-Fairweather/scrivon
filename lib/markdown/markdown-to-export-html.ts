import type { Element, Root as HastRoot, Text as HastText } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Code, Parent, Root, Text } from 'mdast'
import rehypeSanitize from 'rehype-sanitize'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'
import { buildExportDocument, type BuildExportDocumentOptions, type ExportDocument } from '@/lib/markdown/export-document'
import {
    buildPdfExportCss,
    PDF_PAGE_NUMBER_MARK,
    PDF_STAMP_GLYPHS_CLASS,
    pdfChromeShown,
    pdfPageSizeMm,
    pdfStampGlyphText,
    pdfTocMark,
    printDialogPageNumberCss,
    resolvePdfExportLayout,
    resolvePdfPrintOptions,
} from '@/lib/markdown/export-html-css'
import { pdfPageNumberFormat, pdfPageNumberParts, resolvePdfChromeText } from '@/lib/markdown/export-metadata'
import { resolveHeadingAnchor, safeExportHref } from '@/lib/markdown/export-links'
import type { PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { exportSanitizeSchema, rehypeRawWhenNeeded } from '@/lib/markdown/html-sanitize-schema'
import { highlightFencedCode } from '@/lib/markdown/shiki-highlighter'
import { blockDirection } from '@/lib/markdown/text-direction'
import { isExportWebImageUrl } from '@/lib/markdown/web-images'
import { diagramAltText } from '@/lib/mermaid/diagram-alt-text'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { EMPTY_DIAGRAM_MESSAGE, getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import type { PdfExportDocument, PdfExportMetadata, PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

export type PdfRenderOptions = {
    /**
     * Whether the Windows exporter stamps the page numbers into the printed PDF (the default).
     * The system print dialog has no stamper, so then the hidden marks are left out, the TOC
     * has no page column, and footer numbers come from CSS page counters where the engine draws them.
     */
    stamped?: boolean
    /**
     * Whether web images are fetched and printed. Off by default: as in the preview, which shows them only once the
     * user loads them, each one prints as its alt text, so exporting a README fires no tracking pixels and doesn't
     * wait on a slow site.
     */
    allowRemoteImages?: boolean
}

export type MarkdownToExportHtmlOptions = BuildExportDocumentOptions & PdfRenderOptions

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function normalizeShikiPre(html: string): string {
    return html.replace(/\s*tabindex="0"/g, '')
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** A page can't be clicked open, so every <details> prints open: what it holds would otherwise be missing from the PDF. */
function openDetails(hast: HastRoot): void {
    visit(hast, 'element', (node: Element) => {
        if (node.tagName === 'details') node.properties.open = true
    })
}

/**
 * Points each `#heading` link at the id it means, the way Word's bookmarks are matched ({@link resolveHeadingAnchor}),
 * so `#Résumé` or a percent-encoded fragment reaches the heading. A link the preview would leave dead (`javascript:`,
 * `file:`, a Windows path or network share), or one with no address, prints as its words alone, as in Word: the
 * stylesheet colours and underlines every <a>, so it would look clickable. The Contents page is built separately.
 * An old-style `<a name="install">` anchor gets its name as its id, the only one the page may keep (see
 * exportSanitizeSchema), so `#install` links still reach it.
 */
function resolveLinks(hast: HastRoot): void {
    const ids = new Set<string>()
    visit(hast, 'element', (node: Element) => {
        if (node.tagName === 'a' && node.properties.name !== undefined) {
            if (node.properties.id === undefined) node.properties.id = node.properties.name
            delete node.properties.name
        }
        if (typeof node.properties.id === 'string') ids.add(node.properties.id)
    })
    visit(hast, 'element', (node: Element) => {
        if (node.tagName !== 'a') return
        const href = node.properties.href
        if (typeof href === 'string' && href.startsWith('#')) {
            node.properties.href = `#${resolveHeadingAnchor(href.slice(1), ids)}`
            return
        }
        if (typeof href === 'string' && safeExportHref(href) !== null) return
        // Its id, if any, stays, so a link to it still lands here.
        node.tagName = 'span'
        delete node.properties.href
        delete node.properties.hrefLang
    })
}

/**
 * Swaps each web image for its alt text (or `[image]`), unless the user chose to load web images. Markdown images,
 * reference-style ones and raw HTML `<img>` are all <img> elements by now. A web image that is kept is fetched
 * without telling its site which page asked, as in the preview.
 */
function handleWebImages(hast: HastRoot, allowRemoteImages: boolean): void {
    visit(hast, 'element', (node: Element, index, parent) => {
        const src = node.properties.src
        if (node.tagName !== 'img' || typeof src !== 'string' || !isExportWebImageUrl(src)) return
        if (allowRemoteImages) {
            node.properties.referrerPolicy = 'no-referrer'
            return
        }
        if (!parent || index === undefined) return
        const alt = typeof node.properties.alt === 'string' ? node.properties.alt.trim() : ''
        parent.children[index] = { type: 'text', value: alt || '[image]' }
    })
}

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
            // Its own direction, so dir="auto" on the heading skips the mark's Latin letters and reads the heading's.
            properties: { className: ['pdf-heading-mark'], dir: 'ltr' },
            children: [{ type: 'text', value: mark }],
        })
    })
}

/** The text blocks that take their direction from their own first letters, as in the preview. */
const AUTO_DIRECTION_TAGS = new Set([...HEADING_TAGS, 'p', 'li', 'blockquote', 'th', 'td'])
/** Blocks whose words can sit in child paragraphs, which dir="auto" can't see into. See {@link blockDirection}. */
const CONTAINER_DIRECTION_TAGS = new Set(['li', 'blockquote'])

/**
 * Gives each text block dir="auto", so an Arabic or Hebrew paragraph prints right to left with its full stop and
 * bullet on the correct side. A quote or list item that starts right to left gets dir="rtl" instead, so its bar
 * or bullet moves to the right too. A dir the document's HTML set wins. Code is left alone, and so are the
 * paragraphs standing in for code blocks and diagrams, which are swapped for their HTML by exact match. The title
 * page, Contents page and header and footer are built separately, so the stamper still finds their marks.
 */
function setTextDirection(hast: HastRoot, placeholderKeys: ReadonlySet<string>): void {
    visit(hast, 'element', (node: Element) => {
        if (node.tagName === 'pre') return SKIP
        if (!AUTO_DIRECTION_TAGS.has(node.tagName) || node.properties.dir !== undefined) return
        const only = node.children.length === 1 ? node.children[0] : undefined
        if (node.tagName === 'p' && only?.type === 'text' && placeholderKeys.has(only.value)) return
        node.properties.dir = CONTAINER_DIRECTION_TAGS.has(node.tagName) ? blockDirection(node, placeholderKeys) : 'auto'
    })
}

/**
 * Code blocks up to this many lines, and tables up to this many rows, are kept on one page
 * (about half a page at the default size). Anything longer splits between lines or rows, as
 * moving it whole to the next page would leave most of the page before it blank, and it would
 * still split there.
 */
const PDF_KEEP_TOGETHER_MAX_CODE_LINES = 25
const PDF_KEEP_TOGETHER_MAX_TABLE_ROWS = 15

/** Rough width of a character of body text, as a share of the font size, for {@link pdfLineChars}. */
const PDF_AVERAGE_CHAR_EM = 0.55
/** A table cell's side padding and borders, in characters. */
const PDF_TABLE_CELL_PADDING_CHARS = 3

/** About how many characters of body text fit across the page's text width. */
function pdfLineChars(profile: PdfExportProfile): number {
    const sheet = pdfPageSizeMm(profile)
    const sheetWidthMm = profile.page.orientation === 'landscape' ? sheet.height : sheet.width
    const { left, right } = profile.page.marginsMm
    const widthPt = ((sheetWidthMm - left - right) * 72) / 25.4
    return widthPt / (profile.typography.bodySizePt * PDF_AVERAGE_CHAR_EM)
}

/** Characters in the longest run of text in `cell` with nowhere to wrap (CJK text wraps between any characters). */
function longestWordChars(cell: Element): number {
    let longest = 0
    visit(cell, 'text', (text: HastText) => {
        for (const word of text.value.split(/[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/u)) {
            longest = Math.max(longest, [...word].length)
        }
    })
    return longest
}

/** A word longer than this, in a table too wide for the page, may break anywhere: likely a URL, path or identifier. */
const PDF_TABLE_LONG_WORD_CHARS = 12

function addClass(node: Element, className: string): void {
    const classes = Array.isArray(node.properties.className) ? node.properties.className : []
    node.properties.className = [...classes, className]
}

/** A table's rows, as their header and body cells. */
function tableRows(table: Element): Element[][] {
    const rows: Element[][] = []
    visit(table, 'element', (row: Element) => {
        if (row.tagName !== 'tr') return
        rows.push(row.children.filter((cell): cell is Element => cell.type === 'element' && (cell.tagName === 'th' || cell.tagName === 'td')))
    })
    return rows
}

/**
 * Lets a table whose longest words can't sit side by side across the page break them, instead
 * of making Chromium shrink every page to fit it. First only cells with a long word (a URL, path
 * or identifier) may break anywhere, so short cells like `I/D` stay whole; only if the table
 * still can't fit (many columns of short words) may every cell. Tables that fit are left alone.
 */
function fitTableToPage(table: Element, rows: Element[][], lineChars: number): void {
    const words = rows.map((cells) => cells.map(longestWordChars))
    /** How wide the table must be, in characters, to give every column room for its longest unbreakable word. */
    const minChars = (breakLongWords: boolean) => {
        const columns: number[] = []
        words.forEach((row) =>
            row.forEach((chars, index) => {
                const unbreakable = breakLongWords && chars > PDF_TABLE_LONG_WORD_CHARS ? 1 : chars
                columns[index] = Math.max(columns[index] ?? 0, unbreakable)
            })
        )
        return columns.reduce((sum, chars) => sum + chars + PDF_TABLE_CELL_PADDING_CHARS, 0)
    }
    if (minChars(false) <= lineChars) return
    if (minChars(true) > lineChars) {
        addClass(table, 'pdf-wide-table')
        return
    }
    rows.forEach((cells, row) =>
        cells.forEach((cell, index) => {
            if (words[row]![index]! > PDF_TABLE_LONG_WORD_CHARS) addClass(cell, 'pdf-long-word')
        })
    )
}

/**
 * Keeps short tables on one page (see {@link PDF_KEEP_TOGETHER_MAX_TABLE_ROWS}) and lets
 * tables too wide for the page break words (see {@link fitTableToPage}).
 */
function markTables(hast: HastRoot, profile: PdfExportProfile): void {
    const lineChars = pdfLineChars(profile)
    visit(hast, 'element', (node: Element) => {
        if (node.tagName !== 'table') return
        const rows = tableRows(node)
        if (rows.length <= PDF_KEEP_TOGETHER_MAX_TABLE_ROWS) addClass(node, 'pdf-avoid-break')
        fitTableToPage(node, rows, lineChars)
    })
}

async function codeBlockToHtml(node: Code, profile: PdfExportProfile): Promise<string> {
    const text = node.value.replace(/\n$/, '')
    const lang = node.lang?.toLowerCase()
    const blockClass = text.split('\n').length <= PDF_KEEP_TOGETHER_MAX_CODE_LINES ? 'code-block pdf-avoid-break' : 'code-block'

    if (lang === 'mermaid') {
        try {
            const svg = renderMermaidDiagramForExport(text, profile.content.mermaidThemeId)
            // Nothing to draw yet renders a 0×0 picture, which would print as an empty box. Say so, as Word does.
            if (!getSvgDimensions(svg)) return `<pre class="export-error pdf-avoid-break">${escapeHtml(EMPTY_DIAGRAM_MESSAGE)}</pre>`
            // One named picture, as in Word, so a screen reader doesn't read every node label in turn.
            const label = escapeHtml(diagramAltText(text).description)
            return `<div class="mermaid-export pdf-avoid-break" role="img" aria-label="${label}">${svg}</div>`
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return `<pre class="export-error pdf-avoid-break">${escapeHtml(message)}</pre>`
        }
    }

    try {
        const highlighted = normalizeShikiPre(await highlightFencedCode(text, lang, profile.content.codeTheme))
        return `<div class="${blockClass}">${highlighted}</div>`
    } catch {
        return `<div class="${blockClass}"><pre><code>${escapeHtml(text)}</code></pre></div>`
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

/**
 * The glyph sample for a stamped marker: every character its label can use, drawn so the PDF embeds them in the
 * marker's font and the stamper can write the label in that font. It goes first inside the marker, because digits
 * after the marker's code would make the stamper reject the code. Empty when the format draws no label.
 */
function stampGlyphSample(format: string): string {
    const text = pdfStampGlyphText(format)
    return text ? `<span class="${PDF_STAMP_GLYPHS_CLASS}">${escapeHtml(text)}</span>` : ''
}

function renderToc(items: PdfExportOutlineItem[], stamped: boolean): string {
    if (items.length === 0) return ''
    // Every TOC number is in the same font, so the first row's sample is enough for all of them.
    const sample = stamped ? stampGlyphSample('number') : ''
    const list = items
        .map((item, index) => {
            const level = Math.min(item.level, 4)
            // Only the stamper can fill in a TOC page number; without it the row is just the linked title.
            const mark = `${index === 0 ? sample : ''}${pdfTocMark(index, 'slot')}`
            const page = stamped
                ? `<span class="pdf-toc-leader"></span><span class="pdf-toc-num"><span class="pdf-toc-mark">${mark}</span></span>`
                : ''
            return `<li class="pdf-toc-l${level}"><a href="#${escapeHtml(item.id)}"><span class="pdf-toc-title">${escapeHtml(item.text)}</span>${page}</a></li>`
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

function plainLabel(text: string): string {
    return text ? `<span>${escapeHtml(text)}</span>` : ''
}

/**
 * The footer's right-hand text: a page counter slot for the stamper, or plain text.
 * Custom text Helvetica can't draw sits either side of the slot as plain text, so it still
 * prints when the stamper has to fall back to Helvetica for the counter.
 */
function footerRightText(profile: PdfExportProfile, metadata: PdfExportMetadata, stamped: boolean): string {
    const format = profile.footer.pageNumbers
    if (format === 'none') return ''
    const parts = format === 'custom' ? pdfPageNumberParts(profile, metadata) : null
    if (format === 'custom' && !parts) return chromeLabel(profile.footer.right.text, metadata)
    // With no stamper the number is a CSS page counter in the page margin instead.
    if (!stamped) return ''
    // Not profile.footer.pageNumbers: 'custom' alone gives no sample; the format names the counter's text.
    const sample = stampGlyphSample(pdfPageNumberFormat(profile, metadata))
    const slot = `<span class="pdf-page-number"><span class="pdf-page-number-mark">${sample}${PDF_PAGE_NUMBER_MARK}</span></span>`
    return `${plainLabel(parts?.before ?? '')}${slot}${plainLabel(parts?.after ?? '')}`
}

type ChromeSection = 'title' | 'toc' | 'body'

/**
 * Header/footer bar: `[image][text] … [text][image]`, so an image on either
 * end is always the outermost item, nearest the page edge. Nothing for a section
 * that hides the bar, so its images aren't embedded there for nothing.
 */
function renderChromeCell(
    kind: 'header' | 'footer',
    section: ChromeSection,
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata,
    stamped: boolean
): string {
    if (!pdfChromeShown(profile, kind, section)) return ''
    const chrome = kind === 'header' ? profile.header : profile.footer
    const images = kind === 'header' ? assets.header : assets.footer
    const rightText = kind === 'header' ? chromeLabel(chrome.right.text, metadata) : footerRightText(profile, metadata, stamped)
    return `<div class="pdf-chrome-bar pdf-${kind}-bar"><span class="pdf-chrome-side pdf-chrome-left">${chromeImage(images.left)}${chromeLabel(chrome.left.text, metadata)}</span><span class="pdf-chrome-side pdf-chrome-right">${rightText}${chromeImage(images.right)}</span></div>`
}

/**
 * Whether the footer shows on every page of this document. Then it is drawn once,
 * fixed to the page bottom, which Chromium repeats on every page, the last page of
 * a section included. A fixed element can't skip pages, so when the title page or
 * TOC hide the footer, the repeating table footer row draws it instead.
 */
function footerOnEveryPage(profile: PdfExportProfile, hasTitlePage: boolean, hasToc: boolean): boolean {
    if (!resolvePdfExportLayout(profile).showFooter) return false
    const hidden = profile.footer.hideOnFirstPages
    if (hidden === 'none') return true
    return !hasTitlePage && (hidden === 'title' || !hasToc)
}

/**
 * One table per section (title, TOC, body). The repeating header/footer rows
 * give every page of a section its chrome and, in bleed mode, its margins,
 * while the CSS hide rules can still switch the bars off per section.
 * With a fixed footer, the footer row is an invisible copy that only keeps
 * the body clear of it.
 */
function chromeTable(
    kind: ChromeSection,
    inner: string,
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata,
    fixedFooter: boolean,
    stamped: boolean
): string {
    const footClass = fixedFooter ? ' class="pdf-footer-spacer" aria-hidden="true"' : ''
    return `<table class="pdf-chrome-table pdf-${kind}-table">
    <thead class="pdf-chrome-head"><tr><td>${renderChromeCell('header', kind, profile, assets, metadata, stamped)}</td></tr></thead>
    <tbody><tr><td>${inner}</td></tr></tbody>
    <tfoot${footClass}><tr><td>${renderChromeCell('footer', kind, profile, assets, metadata, stamped)}</td></tr></tfoot>
  </table>`
}

function wrapWithChrome(
    titlePageHtml: string,
    tocHtml: string,
    bodyHtml: string,
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata,
    stamped: boolean
): string {
    const body = `<div class="pdf-body">${bodyHtml}</div>`
    const layout = resolvePdfExportLayout(profile)
    // In bleed mode the repeating table rows also supply the page margins, so tables are always needed.
    const needsChrome = layout.showHeader || layout.showFooter || layout.bleed
    if (!needsChrome) {
        return `<article class="export-article">${titlePageHtml}${tocHtml}${body}</article>`
    }

    const fixedFooter = footerOnEveryPage(profile, Boolean(titlePageHtml), Boolean(tocHtml))
    const sections = [
        titlePageHtml ? chromeTable('title', titlePageHtml, profile, assets, metadata, fixedFooter, stamped) : '',
        tocHtml ? chromeTable('toc', tocHtml, profile, assets, metadata, fixedFooter, stamped) : '',
        chromeTable('body', body, profile, assets, metadata, fixedFooter, stamped),
    ]
    const footer = fixedFooter
        ? `\n  <div class="pdf-fixed-footer">${renderChromeCell('footer', 'body', profile, assets, metadata, stamped)}</div>`
        : ''
    return `<article class="export-article">
  ${sections.filter(Boolean).join('\n  ')}${footer}
</article>`
}

/**
 * Markdown + profile (+ overrides) → the branded, self-contained HTML document
 * and the print settings that must accompany it. Throws `Nothing to export.`
 * when the body is empty after front matter is removed.
 */
export async function markdownToExportHtml(source: string, options: MarkdownToExportHtmlOptions = {}): Promise<PdfExportDocument> {
    const { stamped, allowRemoteImages, ...build } = options
    return renderExportPdf(buildExportDocument(source, build), { stamped, allowRemoteImages })
}

/** PDF renderer for an {@link ExportDocument}. Replaces fenced code in `tree` with HTML placeholders. */
export async function renderExportPdf(
    document: ExportDocument,
    { stamped = true, allowRemoteImages = false }: PdfRenderOptions = {}
): Promise<PdfExportDocument> {
    const { profile, assets, metadata, lang, tree, toc: tocItems } = document
    const placeholders = await transformCodeBlocks(tree, profile)

    // Safe raw HTML (<br>, <kbd>, <details>…) prints as it shows in the preview; anything else, and comments, are dropped.
    const hast = unified()
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRawWhenNeeded)
        .use(rehypeSanitize, exportSanitizeSchema)
        .runSync(tree) as HastRoot
    openDetails(hast)
    handleWebImages(hast, allowRemoteImages)
    resolveLinks(hast)
    markTables(hast, profile)
    setTextDirection(hast, new Set(placeholders.keys()))
    if (stamped) addHeadingMarks(hast, tocItems)
    let bodyHtml = toHtml(hast, { allowDangerousHtml: false })

    for (const [key, html] of placeholders) {
        // The block replaces its whole placeholder paragraph: a <div> inside a <p> is invalid and leaves stray empty paragraphs.
        bodyHtml = bodyHtml.split(`<p>${key}</p>`).join(html).split(key).join(html)
    }

    const titlePage = profile.frontMatter.titlePage ? renderTitlePage(metadata, assets) : ''
    const toc = renderToc(tocItems, stamped)
    const baseCss = buildPdfExportCss(profile, metadata)
    const stylesheet = stamped ? baseCss : `${baseCss}\n  ${printDialogPageNumberCss(profile, metadata)}`
    // Backstop for any profile value written into the CSS raw: `</style` would end the stylesheet and start markup.
    const css = stylesheet.replace(/<\/(style)/gi, '<\\/$1')

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(metadata.title)}</title>
  <style>${css}</style>
</head>
<body>
  ${wrapWithChrome(titlePage, toc, bodyHtml, profile, assets, metadata, stamped)}
</body>
</html>`

    return { html, metadata, print: resolvePdfPrintOptions(profile, metadata) }
}
