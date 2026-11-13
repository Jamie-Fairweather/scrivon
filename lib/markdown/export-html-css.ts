import { pdfPageNumberFormat, pdfPageNumberTemplate } from '@/lib/markdown/export-metadata'
import { GITHUB_ALERT_COLOURS, GITHUB_ALERT_KINDS } from '@/lib/markdown/github-alerts'
import type { PdfExportMetadata, PdfExportProfile, PdfMarginsMm, PdfNewPageFromHeading, PdfPrintOptions } from '@/lib/settings/pdf-export-types'
import { getDiagramColors } from '@/lib/theme/catalog'

export type PdfExportLayout = {
    showHeader: boolean
    showFooter: boolean
    headerBleeds: boolean
    footerBleeds: boolean
    logoBleeds: boolean
    /**
     * True when anything must reach the page edge. The printer's own margins
     * clip everything outside them, so in this mode the page is printed with
     * zero margins and the profile margins are emulated in CSS instead.
     */
    bleed: boolean
}

/** Whether the footer's right-hand slot has anything to show (a preset counter or non-empty custom text). */
export function pdfFooterHasPageText(footer: PdfExportProfile['footer']): boolean {
    const format = footer.pageNumbers
    if (format === 'none') return false
    return format !== 'custom' || footer.right.text.trim() !== ''
}

/**
 * The profile as the export draws it. Page numbers have their own setting and still
 * print with the Footer switch off, but nothing else of the footer does: no text,
 * images, colours, size, gap or edge-to-edge band.
 */
export function applyPdfFooterSwitch(profile: PdfExportProfile): PdfExportProfile {
    const { footer } = profile
    if (footer.enabled) return profile
    return {
        ...profile,
        footer: {
            ...footer,
            left: { text: '', imagePath: '' },
            right: { ...footer.right, imagePath: '' },
            backgroundColor: '',
            textColor: '',
            heightMm: 0,
            gapMm: 0,
            ignoreMargins: false,
        },
    }
}

export function resolvePdfExportLayout(profile: PdfExportProfile): PdfExportLayout {
    const showHeader = profile.header.enabled
    const showFooter = profile.footer.enabled || pdfFooterHasPageText(profile.footer)
    const headerBleeds = showHeader && profile.header.ignoreMargins
    const footerBleeds = showFooter && profile.footer.ignoreMargins
    const logoBleeds = profile.frontMatter.titlePage && profile.brand.logoIgnoreMargins && profile.brand.logoPath.trim() !== ''
    return {
        showHeader,
        showFooter,
        headerBleeds,
        footerBleeds,
        logoBleeds,
        bleed: headerBleeds || footerBleeds || logoBleeds,
    }
}

/** Portrait sheet dimensions for the profile's paper size; orientation is applied separately. */
export function pdfPageSizeMm(profile: PdfExportProfile): { width: number; height: number } {
    return profile.page.size === 'letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 }
}

/** Margins the print engine itself must apply; zero when the CSS emulates them. */
export function pdfPrintMarginsMm(profile: PdfExportProfile): PdfMarginsMm {
    if (resolvePdfExportLayout(profile).bleed) return { top: 0, right: 0, bottom: 0, left: 0 }
    return { ...profile.page.marginsMm }
}

/** Print-engine settings that must agree with the CSS `@page` rules and footer markers this module emits. */
export function resolvePdfPrintOptions(profile: PdfExportProfile, metadata: PdfExportMetadata): PdfPrintOptions {
    const page = pdfPageSizeMm(profile)
    const margins = pdfPrintMarginsMm(profile)
    const author = metadata.author.trim()
    const subject = metadata.subtitle.trim()
    return {
        pageWidthMm: page.width,
        pageHeightMm: page.height,
        landscape: profile.page.orientation === 'landscape',
        marginTopMm: margins.top,
        marginRightMm: margins.right,
        marginBottomMm: margins.bottom,
        marginLeftMm: margins.left,
        pageNumberFormat: pdfPageNumberFormat(profile, metadata),
        pageNumberColor: profile.footer.textColor.trim(),
        // Word files get these as creator and description; the PDF stamper writes them into the file's properties.
        ...(author ? { author } : {}),
        ...(subject ? { subject } : {}),
    }
}

/**
 * Marker text rendered (practically invisibly) inside the footer's page-number
 * slot. Chromium (WebView2 included) only resolves `counter(page)`/`counter(pages)`
 * inside `@page` margin boxes, and the footer is an in-page bar (a fixed element,
 * with images, backgrounds and edge-to-edge bands), so its number is stamped after
 * printing: the Rust side locates this marker in the PDF to learn where the number
 * belongs, then draws the real value right-aligned to it. Pages before the first
 * marker get no number, and later pages without one get it where the others put
 * theirs, so a footer hidden on the title page or TOC draws its marker only once,
 * on the first page that shows it. TOC numbers are always stamped, since
 * `target-counter()` is unsupported. The print-dialog path, which has no stamper,
 * uses a margin box instead ({@link printDialogPageNumberCss}).
 * Must match `FOOTER_MARK` in `src-tauri/src/page_numbers.rs`.
 */
export const PDF_PAGE_NUMBER_MARK = 'SFPN'

/** Paired marks linking a TOC row to the heading it points at. Must match `page_numbers.rs`. */
export function pdfTocMark(index: number, kind: 'slot' | 'heading'): string {
    const id = String(index + 1).padStart(4, '0')
    return kind === 'slot' ? `SFT${id}` : `SFH${id}`
}

/** Class of the glyph sample that goes first inside a page-number or TOC marker. */
export const PDF_STAMP_GLYPHS_CLASS = 'pdf-stamp-glyphs'

/** The text around the number in each preset page-number format, as `format_page_label` in `page_numbers.rs` draws it. */
const PRESET_FIXED_TEXT = new Map([
    ['number', ''],
    ['page-n', 'Page '],
    ['n-of-total', ' / '],
])

/**
 * Every character a stamped label in this page-number format can use, each once: the
 * format's fixed text (`Page `, ` / `, a custom counter's words) and the digits. Use
 * `'number'` for TOC numbers. The export draws it, tiny and practically invisible, as
 * the first thing inside the marker (`<span class="pdf-stamp-glyphs">`), so Chromium
 * embeds those glyphs in the marker's font. The stamper then draws the label in that
 * font, matching the text around it, and cuts the sample out of the PDF's text. A
 * label with a character the font lacks is drawn in Helvetica instead.
 */
export function pdfStampGlyphText(format: string): string {
    const fixed = format.startsWith('custom:')
        ? format.slice('custom:'.length).replace(/\{\{\s*(page|total)\s*\}\}/g, '')
        : PRESET_FIXED_TEXT.get(format)
    if (fixed === undefined) return ''
    const others = [...new Set(fixed.replace(/[\s0-9]/g, ''))].join('')
    // A space goes between digits, never at an end, where layout could drop it.
    return `01234${/\s/.test(fixed) ? ' ' : ''}56789${others}`
}

function pageSizeCss(profile: PdfExportProfile): string {
    const size = profile.page.size === 'letter' ? 'letter' : 'A4'
    return profile.page.orientation === 'landscape' ? `${size} landscape` : size
}

function marginCss(margins: PdfMarginsMm): string {
    const { top, right, bottom, left } = margins
    return `${top}mm ${right}mm ${bottom}mm ${left}mm`
}

function chromeBarCss(kind: 'header' | 'footer', chrome: PdfExportProfile['header'], bleeds: boolean, margins: PdfMarginsMm): string {
    const rules: string[] = []
    if (chrome.backgroundColor) rules.push(`background: ${chrome.backgroundColor};`)
    if (chrome.textColor.trim()) rules.push(`color: ${chrome.textColor.trim()};`)
    if (chrome.heightMm > 0) rules.push(`height: ${chrome.heightMm}mm;`)
    // Space between the bar and the body. In bleed mode the bar sits in the margin band,
    // so the body only moves once bar + gap outgrow the margin.
    if (chrome.gapMm > 0) rules.push(`margin-${kind === 'header' ? 'bottom' : 'top'}: ${chrome.gapMm}mm;`)
    // A full-bleed bar keeps its text aligned with the body by padding out to the side margins.
    if (bleeds) rules.push(`padding-left: ${margins.left}mm; padding-right: ${margins.right}mm;`)
    return rules.join('\n    ')
}

/** In a fixed-height bar the images may grow to fill it (minus the bar's vertical padding). */
function chromeImageCss(kind: 'header' | 'footer', chrome: PdfExportProfile['header']): string {
    if (chrome.heightMm <= 0) return ''
    return `.pdf-${kind}-bar img { max-height: calc(${chrome.heightMm}mm - 0.7rem); }`
}

/**
 * Zero-margin page with the profile margins rebuilt in CSS. The repeating
 * header/footer table rows supply the top/bottom margins on every page; a bar
 * that ignores margins is drawn inside that band, flush with the page edge,
 * and only pushes the body down when it is taller than the margin.
 */
function bleedLayoutCss(profile: PdfExportProfile, layout: PdfExportLayout, margins: PdfMarginsMm): string {
    if (!layout.bleed) return ''
    const { top, right, bottom, left } = margins
    const headCell = layout.headerBleeds ? `padding: 0; height: ${top}mm;` : `padding: ${top}mm ${right}mm 0 ${left}mm;`
    const footCell = layout.footerBleeds ? `padding: 0; height: ${bottom}mm;` : `padding: 0 ${right}mm ${bottom}mm ${left}mm;`
    // The fixed footer sits where the footer cell would: in the bottom margin band, bar at its foot.
    const fixedFoot = layout.footerBleeds
        ? `min-height: ${bottom}mm; display: flex; flex-direction: column; justify-content: flex-end;`
        : `padding: 0 ${right}mm ${bottom}mm ${left}mm;`
    // With a header on the cover the image simply follows it (and its gap); without one the
    // top margin spacer goes too, so the image reaches the page edge.
    const headerOnCover = layout.showHeader && profile.header.hideOnFirstPages === 'none'
    return `.pdf-chrome-table > thead > tr > td { ${headCell} vertical-align: top; }
  .pdf-chrome-table > tbody > tr > td { padding: 0 ${right}mm 0 ${left}mm; }
  .pdf-chrome-table > tfoot > tr > td { ${footCell} vertical-align: bottom; }
  .pdf-fixed-footer { ${fixedFoot} }
  ${
      layout.logoBleeds
          ? `${headerOnCover ? '' : '.pdf-title-table > thead > tr > td { padding: 0; height: auto; }'}
  .pdf-title-table > tbody > tr > td { vertical-align: top; }
  .pdf-title-page { height: ${titlePageRoomMm(profile, layout)}mm; min-height: 0; max-height: none; padding-top: 0; justify-content: flex-start; }
  .pdf-title-page .pdf-logo {
    width: calc(100% + ${left + right}mm);
    max-width: none;
    margin: 0 -${right}mm 0 -${left}mm;
    object-fit: cover;
  }
  .pdf-title-body { flex: 1 0 auto; justify-content: center; padding-top: 10mm; }`
          : ''
  }`
}

function linkColor(profile: PdfExportProfile): string {
    return profile.brand.linkColor.trim() || profile.brand.accentColor
}

/** Text safe inside a double-quoted CSS string in a <style> element. */
function escapeCssString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/</g, '\\3c ')
        .replace(/[\r\n]+/g, ' ')
}

function headingPageBreakCss(level: PdfNewPageFromHeading): string {
    if (level < 1) return ''
    const selectors = Array.from({ length: level }, (_, index) => `.pdf-body h${index + 1}`).join(', ')
    const firstChild = Array.from({ length: level }, (_, index) => `h${index + 1}`).join(', ')
    return `${selectors} { break-before: page; page-break-before: always; }
    .pdf-body > :is(${firstChild}):first-child { break-before: auto; page-break-before: auto; }`
}

/**
 * Reserves room for the stamped label, which the PDF stage draws right-aligned to
 * this slot and which can therefore only grow leftwards into the bar. Sized from
 * exactly what the stamper draws, the filled-in title included. When the title page
 * or TOC hide the footer, only the anchor copy draws its marker (see wrapWithChrome).
 */
function pageNumberCss(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    if (!pdfFooterHasPageText(profile.footer)) return ''
    const format = pdfPageNumberFormat(profile, metadata)
    const sample = format.startsWith('custom:')
        ? format.slice('custom:'.length).replace(/\{\{\s*(page|total)\s*\}\}/g, '000')
        : format === 'n-of-total'
          ? '000 / 000'
          : 'Page 000'
    const widthEm = Math.max(3.5, sample.trim().length * 0.55)
    return `.pdf-page-number { min-width: ${widthEm.toFixed(1)}em; text-align: right; white-space: nowrap; }
    .pdf-page-number-mark { color: rgba(64, 64, 64, 0.01); }
    .pdf-footer-anchor .pdf-page-number-mark { visibility: visible; }
    .pdf-footer-unmarked .pdf-page-number-mark { visibility: hidden; }`
}

function hiddenChromeSections(firstPages: PdfExportProfile['header']['hideOnFirstPages']): string[] {
    if (firstPages === 'none') return []
    return firstPages === 'title' ? ['.pdf-title-table'] : ['.pdf-title-table', '.pdf-toc-table']
}

/** Whether a header or footer bar shows on the pages of one section: the title page, the TOC or the body. */
export function pdfChromeShown(profile: PdfExportProfile, kind: 'header' | 'footer', section: 'title' | 'toc' | 'body'): boolean {
    const layout = resolvePdfExportLayout(profile)
    if (!(kind === 'header' ? layout.showHeader : layout.showFooter)) return false
    const chrome = kind === 'header' ? profile.header : profile.footer
    return !hiddenChromeSections(chrome.hideOnFirstPages).includes(`.pdf-${section}-table`)
}

function chromeHideCss(firstPages: PdfExportProfile['header']['hideOnFirstPages'], barClass: string): string {
    const sections = hiddenChromeSections(firstPages)
    if (sections.length === 0) return ''
    return `${sections.map((section) => `${section} ${barClass}`).join(', ')} { display: none !important; }`
}

/** CSS `content` for a page counter that reads like the stamper's label for the same format. */
function pageCounterContent(format: string): string {
    if (format === 'number') return 'counter(page)'
    if (format === 'page-n') return '"Page " counter(page)'
    if (format === 'n-of-total') return 'counter(page) " / " counter(pages)'
    if (!format.startsWith('custom:')) return ''
    return format
        .slice('custom:'.length)
        .split(/(\{\{\s*(?:page|total)\s*\}\})/)
        .filter(Boolean)
        .map((part) => {
            if (/^\{\{\s*page\s*\}\}$/.test(part)) return 'counter(page)'
            if (/^\{\{\s*total\s*\}\}$/.test(part)) return 'counter(pages)'
            return `"${escapeCssString(part)}"`
        })
        .join(' ')
}

/** Named page for the sections that hide the footer, so the print-dialog page counter skips them. */
const NO_FOOTER_PAGE = 'pdf-no-footer'

/**
 * Page numbers for a print no stamper fills in (the system print dialog): a CSS page counter
 * in the bottom-right page margin, just under the footer bar, in the stamper's label format.
 * Chromium draws it; an engine without page margin boxes prints none. Always the bar's default
 * colour, since it sits on bare paper. Nothing when the sheet has no bottom margin to draw in.
 */
export function printDialogPageNumberCss(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    // The browser draws any script, so the margin box gets the whole custom text, not just the stamper's part.
    const template = pdfPageNumberTemplate(profile, metadata)
    const format = profile.footer.pageNumbers === 'custom' ? (template ? `custom:${template}` : 'none') : profile.footer.pageNumbers
    const content = pageCounterContent(format)
    if (!content || pdfPrintMarginsMm(profile).bottom <= 0) return ''
    const hidden = hiddenChromeSections(profile.footer.hideOnFirstPages)
    const skip =
        hidden.length > 0 ? `${hidden.join(', ')} { page: ${NO_FOOTER_PAGE}; }\n  @page ${NO_FOOTER_PAGE} { @bottom-right { content: none; } }` : ''
    return `@page {
    @bottom-right {
      content: ${content};
      vertical-align: top;
      text-align: right;
      padding-top: 1.5mm;
      font-family: ${profile.typography.bodyFont};
      font-size: ${(profile.typography.bodySizePt * 0.85).toFixed(2)}pt;
      color: #404040;
    }
  }
  ${skip}`
}

/** Rough height of a header or footer bar left at "0 fits the content". */
export const PDF_AUTO_BAR_HEIGHT_MM = 12

/**
 * How far a page's text starts from the top or bottom edge: the margin, plus a shown bar's
 * height (PDF_AUTO_BAR_HEIGHT_MM when it fits its content) and gap. A bar that ignores
 * margins sits inside the margin band, so it only takes more room once it outgrows the margin.
 */
function edgeBandMm(margin: number, bar: PdfExportProfile['header'], shown: boolean, bleeds: boolean): number {
    if (!shown) return margin
    const barMm = (bar.heightMm > 0 ? bar.heightMm : PDF_AUTO_BAR_HEIGHT_MM) + bar.gapMm
    return bleeds ? Math.max(margin, barMm) : margin + barMm
}

/** Height of the sheet the way it is turned. */
function sheetHeightMm(profile: PdfExportProfile): number {
    const { width, height } = pdfPageSizeMm(profile)
    return profile.page.orientation === 'landscape' ? width : height
}

/**
 * Page height left for the document text once the top and bottom margins and any shown
 * header/footer are taken off (see edgeBandMm). With the Footer switch off, page numbers
 * still print, but on their own: the export drops the footer's height, gap and edge-to-edge
 * band (applyPdfFooterSwitch), so only a bare content-sized row counts.
 * Negative when they add up to more than the page.
 */
export function pdfBodyHeightMm(profile: PdfExportProfile): number {
    const drawn = applyPdfFooterSwitch(profile)
    const layout = resolvePdfExportLayout(drawn)
    const { top, bottom } = drawn.page.marginsMm
    return (
        sheetHeightMm(drawn) -
        edgeBandMm(top, drawn.header, layout.showHeader, layout.headerBleeds) -
        edgeBandMm(bottom, drawn.footer, layout.showFooter, layout.footerBleeds)
    )
}

/** Slack for table-cell padding and rounding, so the cover never tips onto a second page. */
const TITLE_PAGE_SLACK_MM = 4

/**
 * Room the title page has on its sheet, whichever way the sheet is turned: the page less
 * its margins, any header shown on the cover, and the footer's band, which the footer takes
 * there or, when the cover hides it, the copy that covers it. A bar that ignores margins
 * sits inside the margin band, so only the part that outgrows the margin counts.
 */
function titlePageRoomMm(profile: PdfExportProfile, layout: PdfExportLayout): number {
    const { top, bottom } = profile.page.marginsMm
    const headerOnCover = layout.showHeader && profile.header.hideOnFirstPages === 'none'
    // An edge-to-edge cover image with no header above it starts at the very top of the sheet.
    const topRoom = layout.logoBleeds && !headerOnCover ? 0 : edgeBandMm(top, profile.header, headerOnCover, layout.headerBleeds)
    const bottomRoom = edgeBandMm(bottom, profile.footer, layout.showFooter, layout.footerBleeds)
    return Math.max(40, Math.floor(sheetHeightMm(profile) - topRoom - bottomRoom - TITLE_PAGE_SLACK_MM))
}

/**
 * Height range of a normal (not edge-to-edge) title page: at least its classic size, the
 * printable height less 40mm, and at most the room it has, where the logo starts to shrink.
 */
function titlePageHeightMm(profile: PdfExportProfile, layout: PdfExportLayout): { min: number; max: number } {
    const { top, bottom } = profile.page.marginsMm
    const max = titlePageRoomMm(profile, layout)
    return { min: Math.min(Math.max(100, Math.round(sheetHeightMm(profile) - top - bottom - 40)), max), max }
}

/** Tallest a body image can print and still fit on one page: the room the settings warning reports. */
function bodyImageMaxHeightMm(profile: PdfExportProfile): number {
    // A little slack for the line box the image sits in.
    return Math.max(40, Math.floor(pdfBodyHeightMm(profile) - 6))
}

/** Room the diagram box's padding and border take around its SVG. */
const MERMAID_BOX_MM = 8

const NO_METADATA: PdfExportMetadata = { title: '', subtitle: '', author: '', date: '' }

/** Each alert kind's bar and title colour. */
function alertCss(): string {
    return GITHUB_ALERT_KINDS.map((kind) => {
        const colour = `#${GITHUB_ALERT_COLOURS[kind]}`
        return `.markdown-alert-${kind} { border-inline-start-color: ${colour}; }\n  .markdown-alert-${kind} > .markdown-alert-title { color: ${colour}; }`
    }).join('\n  ')
}

/** The export stylesheet. `metadata` fills the placeholders the page-number slot is sized for. */
export function buildPdfExportCss(profile: PdfExportProfile, metadata: PdfExportMetadata = NO_METADATA): string {
    const mermaidBg = getDiagramColors(profile.content.mermaidThemeId).bg
    const accent = profile.brand.accentColor
    const links = linkColor(profile)
    const watermark = profile.content.watermark.trim()
    const layout = resolvePdfExportLayout(profile)
    const { showHeader, showFooter } = layout
    const margins = profile.page.marginsMm
    const titlePage = titlePageHeightMm(profile, layout)

    return `
  *, *::before, *::after { box-sizing: border-box; }
  html { color-scheme: light only; }
  html, body {
    margin: 0;
    background: #ffffff;
    color: #262626;
  }
  @page {
    size: ${pageSizeCss(profile)};
    margin: ${marginCss(pdfPrintMarginsMm(profile))};
  }
  @media print {
    html, body {
      background: #ffffff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Only short code blocks and tables get .pdf-avoid-break: a long one splits rather than leaving a mostly blank page. */
    .pdf-avoid-break,
    .mermaid-export {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /* A heading stays with what follows it instead of ending a page on its own. */
    .pdf-body h1, .pdf-body h2, .pdf-body h3, .pdf-body h4, .pdf-body h5, .pdf-body h6 {
      break-after: avoid;
      page-break-after: avoid;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    ${headingPageBreakCss(profile.flow.newPageFromHeading)}
  }
  .export-article {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
    font-family: ${profile.typography.bodyFont};
    font-size: ${profile.typography.bodySizePt}pt;
    line-height: ${profile.typography.lineHeight};
    /* A long URL or token breaks instead of widening the page, which would make Chromium shrink every page. */
    overflow-wrap: anywhere;
    position: relative;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: ${profile.typography.headingFont};
    color: ${accent};
  }
  /* Sizes follow the body size (em), never the browser's fixed 16px root; at 11pt they match the old look. */
  h1 { margin: 0 0 1rem; font-size: 1.64em; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 1.5rem 0 0.75rem; font-size: 1.36em; font-weight: 600; }
  h3 { margin: 1.25rem 0 0.5rem; font-size: 1.23em; font-weight: 600; }
  h4 { margin: 1rem 0 0.5rem; font-size: 1.09em; font-weight: 600; }
  h5 { margin: 1rem 0 0.5rem; font-size: 1em; font-weight: 600; }
  h6 { margin: 1rem 0 0.5rem; font-size: 0.9em; font-weight: 600; }
  p { margin: 0 0 0.75rem; }
  ${
      profile.typography.justify
          ? `/* A paragraph whose HTML aligns it (<p align="center">) keeps that: this rule would override the attribute. */
  .pdf-body > p:not([align]) { text-align: justify; }`
          : ''
  }
  /* Each item steps in from its own start side, so a right-to-left item in a left-to-right list keeps its bullet on the page. */
  ul, ol { margin: 0 0 0.75rem; padding-inline-start: 0; }
  li { margin: 0.25rem 0; margin-inline-start: 1.25rem; word-break: break-word; }
  /* A bulleted task's checkbox sits where its bullet would, as in the preview and Word; a numbered one keeps its number. */
  ul > li.task-list-item { list-style: none; }
  li.task-list-item > input[type="checkbox"],
  li.task-list-item > p:first-child > input[type="checkbox"] { margin-block: 0; margin-inline: 0 0.25rem; vertical-align: middle; }
  ul > li.task-list-item > input[type="checkbox"],
  ul > li.task-list-item > p:first-child > input[type="checkbox"] { margin-inline-start: -1.25rem; }
  blockquote {
    margin: 0 0 0.75rem;
    padding-inline-start: 1rem;
    border-inline-start: 2px solid ${accent};
    color: #525252;
    font-style: italic;
  }
  /* GitHub's alerts: a bar and title in the kind's colour, with plain text. */
  .markdown-alert {
    margin: 0 0 0.75rem;
    padding: 0.25rem 0;
    padding-inline-start: 1rem;
    border-inline-start: 3px solid #e5e5e5;
  }
  .markdown-alert > :last-child { margin-bottom: 0; }
  .markdown-alert-title { margin-bottom: 0.25rem; font-weight: 600; }
  ${alertCss()}
  /* Block math sits on its own line, centred. */
  math[display="block"] { margin: 0 0 0.75rem; }
  /* max-width: a raw <hr width="3000"> can't widen the page either. */
  hr { margin: 1.5rem 0; border: none; border-top: 1px solid #e5e5e5; max-width: 100%; }
  /*
   * The footnotes' "Footnotes" heading is for screen readers only, as in the preview: printed, it would be an
   * English heading in any document, and a new page with 'New page from heading'. A rule sets the notes apart instead.
   */
  .pdf-body section.footnotes > #footnote-label { display: none; }
  .pdf-body section.footnotes { margin-top: 1.5rem; padding-top: 0.75rem; border-top: 1px solid #e5e5e5; font-size: 0.9em; }
  a { color: ${links}; text-decoration: underline; }
  .export-article :not(pre) > code {
    font-family: ${profile.typography.monoFont};
    font-size: 0.85em;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    background: #f5f5f5;
    border: 1px solid #ebebeb;
  }
  table:not(.pdf-chrome-table) {
    width: 100%;
    margin: 0 0 1rem;
    border-collapse: collapse;
    font-size: 1em;
  }
  thead:not(.pdf-chrome-head) { background: rgba(0, 0, 0, 0.04); }
  table:not(.pdf-chrome-table) th,
  table:not(.pdf-chrome-table) td {
    padding: 0.5rem 0.75rem;
    border: 1px solid #e5e5e5;
    text-align: start;
    vertical-align: top;
    /* Columns keep room for their longest word; 'anywhere' would squeeze short columns mid-word. */
    overflow-wrap: break-word;
  }
  /* Unless those words can't fit across the page side by side: then Chromium would shrink every page to fit the table. */
  table:not(.pdf-chrome-table) .pdf-long-word,
  table.pdf-wide-table:not(.pdf-chrome-table) th,
  table.pdf-wide-table:not(.pdf-chrome-table) td { overflow-wrap: anywhere; }
  /* A raw HTML <td nowrap> wraps too: one long unbroken line would make the table wider than the page. */
  table:not(.pdf-chrome-table) :is(td, th)[nowrap] { white-space: normal; }
  /* Markdown column alignment (:-: and --:) arrives as an align attribute, which any stylesheet rule would override. */
  table:not(.pdf-chrome-table) th[align="left"],
  table:not(.pdf-chrome-table) td[align="left"] { text-align: left; }
  table:not(.pdf-chrome-table) th[align="center"],
  table:not(.pdf-chrome-table) td[align="center"] { text-align: center; }
  table:not(.pdf-chrome-table) th[align="right"],
  table:not(.pdf-chrome-table) td[align="right"] { text-align: right; }
  table:not(.pdf-chrome-table) th { font-weight: 600; }
  .pdf-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /*
   * A raw HTML <pre> (ASCII art, terminal output) wraps like a code block: one line wider than the
   * page would make Chromium shrink every page. The code block rules below come later and win.
   */
  .pdf-body pre:not([class]) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: ${profile.typography.monoFont};
    font-size: 0.82em;
    tab-size: 2;
  }
  .code-block { margin: 0 0 1rem; }
  .code-block pre.shiki {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    font-family: ${profile.typography.monoFont};
    font-size: 0.82em;
    line-height: 1.45;
    /* Paper can't scroll: long lines wrap instead of being cut off at the box edge. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }
  .code-block pre.shiki code {
    display: block;
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
    line-height: inherit;
    white-space: inherit;
  }
  .code-block pre:not(.shiki) {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    font-family: ${profile.typography.monoFont};
    font-size: 0.82em;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }
  .code-block pre:not(.shiki) code {
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
    line-height: inherit;
    white-space: inherit;
  }
  .mermaid-export {
    margin: 0 0 1rem;
    padding: 12px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    background: ${mermaidBg};
    overflow: hidden;
  }
  /* A diagram taller than a page shrinks to fit one: an SVG can't split, so it would be pushed past a blank page and sliced. */
  .mermaid-export svg {
    display: block;
    max-width: 100%;
    max-height: ${Math.max(40, bodyImageMaxHeightMm(profile) - MERMAID_BOX_MM)}mm;
    width: auto;
    height: auto;
    margin: 0 auto;
  }
  /*
   * Body images shrink (keeping their shape) to the text width and to what fits on one page.
   * A size the document's HTML gives (<img width="120">) stays: any width or height set here
   * would override it. Only a height without a width is kept as given; otherwise the height
   * follows the width.
   */
  .pdf-body img {
    max-width: 100%;
    max-height: ${bodyImageMaxHeightMm(profile)}mm;
    object-fit: contain;
  }
  .pdf-body img[width], .pdf-body img:not([height]) { height: auto; }
  .export-error {
    margin: 0 0 1rem;
    padding: 12px;
    border: 1px solid #fecaca;
    border-radius: 8px;
    background: #fef2f2;
    color: #991b1b;
    font-size: 12px;
    white-space: pre-wrap;
    font-family: ${profile.typography.monoFont};
  }
  .pdf-title-page,
  .pdf-toc-page,
  .pdf-title-table,
  .pdf-toc-table {
    break-after: page;
    page-break-after: always;
  }
  .pdf-title-table .pdf-title-page,
  .pdf-toc-table .pdf-toc-page {
    break-after: auto;
    page-break-after: auto;
  }
  /*
   * Print viewport = page area, so a one-page section fills its page: the title page centres on
   * it and its footer row sits at the page bottom. The table is also the frame the footer anchor
   * is placed in, from the top of the section's first page.
   */
  .pdf-chrome-table {
    height: 100vh;
    position: relative;
  }
  /* The cover is one page tall at most; the logo shrinks to leave the title text room on it. */
  .pdf-title-page {
    min-height: ${titlePage.min}mm;
    max-height: ${titlePage.max}mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1.25rem;
    padding: 10mm 0 16mm;
  }
  .pdf-title-body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    flex: 0 0 auto;
  }
  .pdf-title-page .pdf-logo {
    display: block;
    flex: 0 1 auto;
    min-height: 0;
    max-width: 100%;
    max-height: 150mm;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .pdf-title-page h1 {
    margin: 0;
    font-size: 2.18em;
  }
  .pdf-title-meta {
    color: #525252;
    margin: 0;
  }
  .pdf-toc-page h1 {
    margin: 0;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid ${accent};
    font-size: 1.8em;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .pdf-toc-list {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }
  .pdf-toc-list li {
    margin: 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pdf-toc-l1 { margin-top: 0.7rem; }
  .pdf-toc-l1:first-child { margin-top: 0.2rem; }
  .pdf-toc-list a {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.14rem 0;
    color: #262626;
    text-decoration: none;
  }
  .pdf-toc-l1 a {
    font-weight: 600;
    color: #171717;
  }
  .pdf-toc-l2 a { padding-inline-start: 1rem; }
  .pdf-toc-l3 a { padding-inline-start: 2rem; font-size: 0.94em; color: #404040; }
  .pdf-toc-l4 a { padding-inline-start: 3rem; font-size: 0.9em; color: #525252; }
  .pdf-toc-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Raised with top, not transform: a transform makes Chromium paint every leader onto every page of the PDF. */
  .pdf-toc-leader {
    flex: 1 0 1.25rem;
    border-bottom: 1px dotted #a3a3a3;
    position: relative;
    top: -0.25em;
  }
  .pdf-toc-num {
    flex: 0 0 4.2em;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    color: #404040;
    white-space: nowrap;
  }
  .pdf-toc-mark,
  .pdf-heading-mark {
    color: rgba(64, 64, 64, 0.01);
  }
  .pdf-heading-mark {
    font-size: 1px;
    line-height: 0;
  }
  /* Drawn, so its glyphs are embedded for the stamped numbers, but tiny, see-through and taking no room. Not clipped: a clipped sample may not be drawn at all. */
  .${PDF_STAMP_GLYPHS_CLASS} {
    display: inline-block;
    width: 0;
    white-space: pre;
    font-size: 1px;
    line-height: 0;
    color: rgba(64, 64, 64, 0.01);
  }
  /* Fixed layout: wide content can't stretch the section past the page and shrink the whole PDF. */
  .pdf-chrome-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .pdf-chrome-table > thead { display: table-header-group; }
  .pdf-chrome-table > tfoot { display: table-footer-group; }
  /*
   * The footer is drawn once, fixed, and Chromium repeats it at the bottom of each page. A
   * table footer row would float up under the text on the last page of a section, so each
   * section's row is only a copy of the bar: unseen where the footer shows, keeping the text
   * clear of it, and opaque on the title page and TOC when they hide it, covering it.
   */
  .pdf-fixed-footer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2; }
  .pdf-footer-spacer { visibility: hidden; }
  .pdf-footer-cover > tr > td { position: relative; z-index: 3; background: #ffffff; }
  .pdf-footer-cover .pdf-chrome-bar { visibility: hidden; }
  /* When the title page or TOC hide the footer: the one copy whose page-number marker is drawn, at the foot of the first page showing it. */
  .pdf-fixed-footer.pdf-footer-anchor {
    position: absolute;
    top: 0;
    bottom: auto;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    visibility: hidden;
  }
  /* Slack from a stretched section goes below the content; the title page keeps the cell's centring. */
  .pdf-toc-table > tbody > tr > td,
  .pdf-body-table > tbody > tr > td { vertical-align: top; }
  /* Bar = left group + right group; inside each group the image sits outermost, nearest the page edge. */
  .pdf-chrome-bar {
    padding: 0.35rem 0.5rem;
    font-size: 0.85em;
    color: #404040;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .pdf-chrome-side {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .pdf-chrome-right { justify-content: flex-end; text-align: right; }
  .pdf-chrome-bar img {
    display: block;
    max-height: 28px;
    max-width: 160px;
    width: auto;
    height: auto;
  }
  /*
   * Stands in for an image in an unseen copy of a bar that fits its content: as wide and tall as an
   * image can be there, so the copy's text wraps no later than the drawn bar's and the copy is never
   * shorter than it. Taller only leaves a little more gap.
   */
  .pdf-chrome-img-room { display: block; flex: none; width: 160px; height: 28px; }
  ${chromeImageCss('header', profile.header)}
  ${chromeImageCss('footer', profile.footer)}
  .pdf-header-bar {
    ${chromeBarCss('header', profile.header, layout.headerBleeds, margins)}
    display: ${showHeader ? 'flex' : 'none'};
  }
  .pdf-footer-bar {
    ${chromeBarCss('footer', profile.footer, layout.footerBleeds, margins)}
    display: ${showFooter ? 'flex' : 'none'};
  }
  ${bleedLayoutCss(profile, layout, margins)}
  ${pageNumberCss(profile, metadata)}
  ${chromeHideCss(profile.header.hideOnFirstPages, '.pdf-header-bar')}
  ${
      watermark
          ? `.export-article::before {
    content: "${escapeCssString(watermark)}";
    position: fixed;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 4rem;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.08);
    white-space: nowrap;
    pointer-events: none;
    /*
     * Over the section tables, which are positioned (the footer anchor's frame), so it still shows
     * across the cover image, header bars and contents; under the body text, which comes later at
     * the same level, and under the footer and its covers.
     */
    z-index: 1;
  }`
          : ''
  }
  .pdf-body { position: relative; z-index: 1; }
`
}
