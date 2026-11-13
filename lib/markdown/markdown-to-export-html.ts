import type { Element, Root as HastRoot, Text as HastText } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Code, Parent, Root, Text } from 'mdast'
import rehypeSanitize from 'rehype-sanitize'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { EXIT, SKIP, visit } from 'unist-util-visit'
import { buildExportDocument, type BuildExportDocumentOptions, type ExportDocument } from '@/lib/markdown/export-document'
import {
    buildPdfExportCss,
    PDF_BODY_START_MARK,
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
import { htmlAlertKind, isAlertTitle } from '@/lib/markdown/github-alerts'
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

/** Whether the page has math for KaTeX to draw (see mathRehypePlugins), which is only loaded when it does. */
function hasMath(hast: HastRoot): boolean {
    let found = false
    visit(hast, 'element', (node: Element) => {
        const classes = node.properties.className
        if (node.tagName !== 'code' || !Array.isArray(classes) || !classes.includes('language-math')) return
        found = true
        return EXIT
    })
    return found
}

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

/** Hidden mark inside each heading so the PDF stamper can read which page it landed on, for its bookmark and Contents row. */
function addHeadingMarks(hast: HastRoot, outline: PdfExportOutlineItem[]): void {
    if (outline.length === 0) return
    const markById = new Map(outline.map((item, index) => [item.id, pdfTocMark(index, 'heading')]))
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
 * or bullet moves to the right too. A dir the document's HTML set wins. Code reads left to right: a raw <pre>
 * gets dir="ltr", and code blocks and diagrams get theirs where they are built, so the paragraphs standing in for
 * them, which are swapped for their HTML by exact match, are left alone. The title page, Contents page and header
 * and footer are built separately, and their text gets dir="auto" there, kept apart from the stamper's marks.
 */
function setTextDirection(hast: HastRoot, placeholderKeys: ReadonlySet<string>): void {
    visit(hast, 'element', (node: Element) => {
        if (node.tagName === 'pre') {
            node.properties.dir ??= 'ltr'
            return SKIP
        }
        // An alert is a quote. Its English title follows the alert, so it sits on the same side as the bar.
        const alert = htmlAlertKind(node) !== undefined
        if ((!AUTO_DIRECTION_TAGS.has(node.tagName) && !alert) || isAlertTitle(node) || node.properties.dir !== undefined) return
        const only = node.children.length === 1 ? node.children[0] : undefined
        if (node.tagName === 'p' && only?.type === 'text' && placeholderKeys.has(only.value)) return
        node.properties.dir = alert || CONTAINER_DIRECTION_TAGS.has(node.tagName) ? blockDirection(node, placeholderKeys) : 'auto'
    })
}

/**
 * Code blocks up to this many lines, and tables up to this many rows, are kept on one page
 * (about half a page at the default size). Anything longer splits between lines or rows, as
 * moving it whole to the next page would leave most of the page before it blank, and it would
 * still split there.
 */
export const PDF_KEEP_TOGETHER_MAX_CODE_LINES = 25
export const PDF_KEEP_TOGETHER_MAX_TABLE_ROWS = 15

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

/**
 * A fenced block's HTML. Code, diagrams and their errors read left to right whatever the text
 * around them does, so each gets dir="ltr": in a right-to-left list item or quote they would
 * otherwise take its direction, and `foo();` would print as `;()foo`.
 */
async function codeBlockToHtml(node: Code, profile: PdfExportProfile): Promise<string> {
    const text = node.value.replace(/\n$/, '')
    const lang = node.lang?.toLowerCase()
    const blockClass = text.split('\n').length <= PDF_KEEP_TOGETHER_MAX_CODE_LINES ? 'code-block pdf-avoid-break' : 'code-block'

    if (lang === 'mermaid') {
        try {
            const svg = renderMermaidDiagramForExport(text, profile.content.mermaidThemeId)
            // Nothing to draw yet renders a 0×0 picture, which would print as an empty box. Say so, as Word does.
            if (!getSvgDimensions(svg)) return `<pre dir="ltr" class="export-error pdf-avoid-break">${escapeHtml(EMPTY_DIAGRAM_MESSAGE)}</pre>`
            // One named picture, as in Word, so a screen reader doesn't read every node label in turn.
            const label = escapeHtml(diagramAltText(text).description)
            return `<div dir="ltr" class="mermaid-export pdf-avoid-break" role="img" aria-label="${label}">${svg}</div>`
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return `<pre dir="ltr" class="export-error pdf-avoid-break">${escapeHtml(message)}</pre>`
        }
    }

    try {
        const highlighted = normalizeShikiPre(await highlightFencedCode(text, lang, profile.content.codeTheme))
        return `<div dir="ltr" class="${blockClass}">${highlighted}</div>`
    } catch {
        return `<div dir="ltr" class="${blockClass}"><pre><code>${escapeHtml(text)}</code></pre></div>`
    }
}

async function transformCodeBlocks(tree: Root, profile: PdfExportProfile): Promise<Map<string, string>> {
    const exportId = crypto.randomUUID()
    const placeholders = new Map<string, string>()
    const replacements: { parent: Parent; index: number; promise: Promise<string> }[] = []

    visit(tree, 'code', (node: Code, index, parent) => {
        // Printed as math (see hasMath).
        if (node.lang === 'math') return
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

/** The cover. Each line takes its own direction from its first letters, as the body's blocks do. */
function renderTitlePage(metadata: PdfExportMetadata, assets: PdfExportResolvedAssets): string {
    const logo = assets.logoDataUrl ? `<img class="pdf-logo" src="${escapeHtml(assets.logoDataUrl)}" alt="" />` : ''
    const meta = (text: string) => (text ? `<p class="pdf-title-meta" dir="auto">${escapeHtml(text)}</p>` : '')
    return `<section class="pdf-title-page">${logo}<div class="pdf-title-body"><h1 dir="auto">${escapeHtml(metadata.title)}</h1>${meta(metadata.subtitle)}${meta(metadata.author)}${meta(metadata.date)}</div></section>`
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

/** `outline` is every heading: a row's mark carries its heading's place there, as the heading's own mark does. */
function renderToc(items: PdfExportOutlineItem[], outline: PdfExportOutlineItem[], stamped: boolean): string {
    if (items.length === 0) return ''
    // Every TOC number is in the same font, so the first row's sample is enough for all of them.
    const sample = stamped ? stampGlyphSample('number') : ''
    const indexById = new Map(outline.map((item, index) => [item.id, index]))
    const list = items
        .map((item, index) => {
            const level = Math.min(item.level, 4)
            // Only the stamper can fill in a TOC page number; without it the row is just the linked title.
            const mark = `${index === 0 ? sample : ''}${pdfTocMark(indexById.get(item.id) ?? index, 'slot')}`
            const page = stamped
                ? `<span class="pdf-toc-leader"></span><span class="pdf-toc-num"><span class="pdf-toc-mark">${mark}</span></span>`
                : ''
            // Only the title takes its own direction, so a right-to-left one ends and is cut short on the correct side;
            // the row, with its leader and page number, stays as it is.
            return `<li class="pdf-toc-l${level}"><a href="#${escapeHtml(item.id)}"><span class="pdf-toc-title" dir="auto">${escapeHtml(item.text)}</span>${page}</a></li>`
        })
        .join('')
    return `<section class="pdf-toc-page"><h1>Contents</h1><ol class="pdf-toc-list">${list}</ol></section>`
}

function chromeImage(dataUrl: string): string {
    return dataUrl ? `<img src="${escapeHtml(dataUrl)}" alt="" />` : ''
}

function chromeLabel(text: string, metadata: PdfExportMetadata): string {
    return plainLabel(resolvePdfChromeText(text, metadata))
}

/** Header or footer text, which takes its own direction from its first letters, as the body's blocks do. */
function plainLabel(text: string): string {
    return text ? `<span dir="auto">${escapeHtml(text)}</span>` : ''
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
 * end is always the outermost item, nearest the page edge. A `copy` is never
 * seen and only takes up the bar's room, so its images are left out rather than
 * embedded again for nothing: a bar of fixed height keeps its height without
 * them, and otherwise an empty box as big as an image can be stands in, so the
 * copy is never shorter than the drawn bar.
 */
function renderChromeBar(
    kind: 'header' | 'footer',
    profile: PdfExportProfile,
    assets: PdfExportResolvedAssets,
    metadata: PdfExportMetadata,
    stamped: boolean,
    copy = false
): string {
    const chrome = kind === 'header' ? profile.header : profile.footer
    const images = kind === 'header' ? assets.header : assets.footer
    const image = (dataUrl: string) => {
        if (!copy) return chromeImage(dataUrl)
        return dataUrl && chrome.heightMm <= 0 ? '<span class="pdf-chrome-img-room"></span>' : ''
    }
    const rightText = kind === 'header' ? chromeLabel(chrome.right.text, metadata) : footerRightText(profile, metadata, stamped)
    return `<div class="pdf-chrome-bar pdf-${kind}-bar"><span class="pdf-chrome-side pdf-chrome-left">${image(images.left)}${chromeLabel(chrome.left.text, metadata)}</span><span class="pdf-chrome-side pdf-chrome-right">${rightText}${image(images.right)}</span></div>`
}

/**
 * One table per section (title, TOC, body). The repeating header rows give every page of a
 * section its header and, in bleed mode, its top margin; a section that hides the header has
 * none, so its images aren't embedded there for nothing. The footer is drawn once, fixed to
 * the page bottom (see {@link wrapWithChrome}), and each section's repeating footer row is a
 * copy of it that is never seen: on a section that shows the footer it keeps the text clear
 * of it, and on one that hides it (the title page, the TOC) it is opaque and covers it.
 *
 * Known gaps, which only the stamper could close by cutting the fixed footer out of those
 * pages: a cover is a table row, so it reaches the page bottom only on a page the section
 * fills. With 'Title page + TOC' and contents longer than a page, the last contents page
 * ends early and the footer bar (with no number) shows below its cover. And a covered
 * footer's text stays in the PDF's text layer, so search and copy can still find it there.
 */
function chromeTable(kind: ChromeSection, inner: string, header: string, footer: string, coversFooter: boolean): string {
    const foot = footer ? ` class="${coversFooter ? 'pdf-footer-cover' : 'pdf-footer-spacer'}" aria-hidden="true"` : ''
    return `<table class="pdf-chrome-table pdf-${kind}-table">
    <thead class="pdf-chrome-head"><tr><td>${header}</td></tr></thead>
    <tbody><tr><td>${inner}</td></tr></tbody>
    <tfoot${foot}><tr><td>${footer}</td></tr></tfoot>
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

    const sections = (
        [
            ['title', titlePageHtml],
            ['toc', tocHtml],
            ['body', body],
        ] as const
    ).filter(([, html]) => html)
    // Drawn once, fixed: Chromium repeats it at the bottom of every page, the last page of a section included,
    // where a table footer row would float up under the text.
    const footer = layout.showFooter ? renderChromeBar('footer', profile, assets, metadata, stamped) : ''
    const footerCopy = layout.showFooter ? renderChromeBar('footer', profile, assets, metadata, stamped, true) : ''
    // Only the title page and TOC can hide the footer, and they come first.
    const firstShown = sections.findIndex(([kind]) => pdfChromeShown(profile, 'footer', kind))
    // The stamper numbers each page at its footer's page-number marker and leaves the pages before the first
    // marker unnumbered. The fixed footer would put a marker on the title page and TOC too, so when they hide
    // the footer its marker isn't drawn. One copy at the foot of the first page that shows the footer carries
    // the marker instead, and the stamper numbers each later page, which has none, at the same spot. That copy
    // keeps the footer's images, as their size decides where the marker sits.
    const anchored = firstShown > 0 && stamped && pdfPageNumberFormat(profile, metadata) !== 'none'
    const tables = sections.map(([kind, html], index) => {
        const header = pdfChromeShown(profile, 'header', kind) ? renderChromeBar('header', profile, assets, metadata, stamped) : ''
        const anchor = anchored && index === firstShown ? `<div class="pdf-fixed-footer pdf-footer-anchor" aria-hidden="true">${footer}</div>` : ''
        return chromeTable(kind, `${anchor}${html}`, header, footerCopy, index < firstShown)
    })
    const fixed = footer ? `\n  <div class="pdf-fixed-footer${anchored ? ' pdf-footer-unmarked' : ''}">${footer}</div>` : ''
    return `<article class="export-article">
  ${tables.join('\n  ')}${fixed}
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
    const { profile, assets, metadata, lang, tree, outline, toc: tocItems } = document
    const placeholders = await transformCodeBlocks(tree, profile)

    // Safe raw HTML (<br>, <kbd>, <details>…) prints as it shows in the preview; anything else, and comments, are dropped.
    let hast = unified()
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRawWhenNeeded)
        .use(rehypeSanitize, exportSanitizeSchema)
        .runSync(tree) as HastRoot
    if (hasMath(hast)) {
        const { mathRehypePlugins } = await import('@/lib/markdown/rehype-math')
        hast = unified().use(mathRehypePlugins).runSync(hast) as HastRoot
    }
    openDetails(hast)
    handleWebImages(hast, allowRemoteImages)
    resolveLinks(hast)
    markTables(hast, profile)
    setTextDirection(hast, new Set(placeholders.keys()))
    if (stamped) addHeadingMarks(hast, outline)
    let bodyHtml = toHtml(hast, { allowDangerousHtml: false })

    for (const [key, html] of placeholders) {
        // The block replaces its whole placeholder paragraph: a <div> inside a <p> is invalid and leaves stray empty paragraphs.
        bodyHtml = bodyHtml.split(`<p>${key}</p>`).join(html).split(key).join(html)
    }

    // Numbering from the body: the stamper starts at the page this mark lands on. It goes last, so it never becomes the
    // body's first child, and CSS lifts it to the top of the body's first page.
    if (stamped && profile.footer.numberFromBody) bodyHtml += `<span class="pdf-body-mark" dir="ltr">${PDF_BODY_START_MARK}</span>`

    const titlePage = profile.frontMatter.titlePage ? renderTitlePage(metadata, assets) : ''
    const toc = renderToc(tocItems, outline, stamped)
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

    // The stamper turns the headings it finds marked into the PDF's bookmarks.
    const headings = stamped ? { headings: outline.map(({ level, text }) => ({ level, text })) } : {}
    return { html, metadata, print: { ...resolvePdfPrintOptions(profile, metadata), ...headings } }
}
