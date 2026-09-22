import type { PdfExportProfile, PdfMarginsMm, PdfNewPageFromHeading } from '@/lib/settings/pdf-export-types'
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

/**
 * Marker text rendered (practically invisibly) inside the footer's page-number
 * slot. WebView2 never resolves CSS page counters, so the Rust side locates this
 * marker in the printed PDF to learn which pages carry a footer and exactly
 * where the number belongs, then stamps the real value right-aligned to it.
 * Must match `FOOTER_MARK` in `src-tauri/src/page_numbers.rs`.
 */
export const PDF_PAGE_NUMBER_MARK = 'SFPN'

/** Paired marks linking a TOC row to the heading it points at. Must match `page_numbers.rs`. */
export function pdfTocMark(index: number, kind: 'slot' | 'heading'): string {
    const id = String(index + 1).padStart(4, '0')
    return kind === 'slot' ? `SFT${id}` : `SFH${id}`
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
    // With a header on the cover the image simply follows it (and its gap); without one the
    // top margin spacer goes too, so the image reaches the page edge.
    const headerOnCover = layout.showHeader && profile.header.hideOnFirstPages === 'none'
    return `.pdf-chrome-table > thead > tr > td { ${headCell} vertical-align: top; }
  .pdf-chrome-table > tbody > tr > td { padding: 0 ${right}mm 0 ${left}mm; }
  .pdf-chrome-table > tfoot > tr > td { ${footCell} vertical-align: bottom; }
  ${
      layout.logoBleeds
          ? `${headerOnCover ? '' : '.pdf-title-table > thead > tr > td { padding: 0; height: auto; }'}
  .pdf-title-table > tbody > tr > td { vertical-align: top; }
  .pdf-title-page { height: 100%; min-height: 0; padding-top: 0; justify-content: flex-start; }
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

function escapeCssString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
 * this slot and which can therefore only grow leftwards into the bar.
 */
function pageNumberCss(footer: PdfExportProfile['footer']): string {
    if (!pdfFooterHasPageText(footer)) return ''
    const sample =
        footer.pageNumbers === 'custom'
            ? footer.right.text.replace(/\{\{\s*(page|total)\s*\}\}/g, '000').replace(/\{\{[^}]*\}\}/g, '')
            : footer.pageNumbers === 'n-of-total'
              ? '000 / 000'
              : 'Page 000'
    const widthEm = Math.max(3.5, sample.trim().length * 0.55)
    return `.pdf-page-number { min-width: ${widthEm.toFixed(1)}em; text-align: right; white-space: nowrap; }
    .pdf-page-number-mark { color: rgba(64, 64, 64, 0.01); }`
}

function chromeHideCss(firstPages: PdfExportProfile['header']['hideOnFirstPages'], barClass: string): string {
    if (firstPages === 'none') return ''
    const sections = firstPages === 'title' ? ['.pdf-title-table'] : ['.pdf-title-table', '.pdf-toc-table']
    return `${sections.map((section) => `${section} ${barClass}`).join(', ')} { display: none !important; }`
}

/** Room for the title page inside the printable area, whichever way the sheet is turned. */
function titlePageMinHeightMm(profile: PdfExportProfile): number {
    const { width, height } = pdfPageSizeMm(profile)
    const pageHeight = profile.page.orientation === 'landscape' ? width : height
    const { top, bottom } = profile.page.marginsMm
    return Math.max(100, Math.round(pageHeight - top - bottom - 40))
}

export function buildPdfExportCss(profile: PdfExportProfile): string {
    const mermaidBg = getDiagramColors(profile.content.mermaidThemeId).bg
    const accent = profile.brand.accentColor
    const links = linkColor(profile)
    const watermark = profile.content.watermark.trim()
    const layout = resolvePdfExportLayout(profile)
    const { showHeader, showFooter } = layout
    const margins = profile.page.marginsMm

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
    .pdf-avoid-break,
    .code-block,
    .mermaid-export,
    table:not(.pdf-chrome-table) {
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
    position: relative;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: ${profile.typography.headingFont};
    color: ${accent};
  }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 1.5rem 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
  h3 { margin: 1.25rem 0 0.5rem; font-size: 1.125rem; font-weight: 600; }
  h4 { margin: 1rem 0 0.5rem; font-size: 1rem; font-weight: 600; }
  p { margin: 0 0 0.75rem; }
  ul, ol { margin: 0 0 0.75rem; padding-left: 1.25rem; }
  li { margin: 0.25rem 0; word-break: break-word; }
  blockquote {
    margin: 0 0 0.75rem;
    padding-left: 1rem;
    border-left: 2px solid ${accent};
    color: #525252;
    font-style: italic;
  }
  hr { margin: 1.5rem 0; border: none; border-top: 1px solid #e5e5e5; }
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
    text-align: left;
    vertical-align: top;
  }
  table:not(.pdf-chrome-table) th { font-weight: 600; }
  .pdf-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .code-block { margin: 0 0 1rem; }
  .code-block pre.shiki {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    overflow-x: auto;
    font-family: ${profile.typography.monoFont};
    font-size: 12px;
    line-height: 1.45;
    white-space: pre;
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
    overflow-x: auto;
    font-family: ${profile.typography.monoFont};
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
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
  .mermaid-export svg {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
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
  /* Print viewport = page area, so this fills the last page of a section and pins its footer row to the bottom. */
  .pdf-chrome-table {
    height: 100vh;
  }
  .pdf-title-page {
    min-height: ${titlePageMinHeightMm(profile)}mm;
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
  }
  .pdf-title-page .pdf-logo {
    display: block;
    max-width: 100%;
    max-height: 150mm;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .pdf-title-page h1 {
    margin: 0;
    font-size: 2rem;
  }
  .pdf-title-meta {
    color: #525252;
    margin: 0;
  }
  .pdf-toc-page h1 {
    margin: 0;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid ${accent};
    font-size: 1.65rem;
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
  .pdf-toc-l2 a { padding-left: 1rem; }
  .pdf-toc-l3 a { padding-left: 2rem; font-size: 0.94em; color: #404040; }
  .pdf-toc-l4 a { padding-left: 3rem; font-size: 0.9em; color: #525252; }
  .pdf-toc-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pdf-toc-leader {
    flex: 1 0 1.25rem;
    border-bottom: 1px dotted #a3a3a3;
    transform: translateY(-0.25em);
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
  .pdf-chrome-table {
    width: 100%;
    border-collapse: collapse;
  }
  .pdf-chrome-table > thead { display: table-header-group; }
  .pdf-chrome-table > tfoot { display: table-footer-group; }
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
  ${pageNumberCss(profile.footer)}
  ${chromeHideCss(profile.header.hideOnFirstPages, '.pdf-header-bar')}
  ${chromeHideCss(profile.footer.hideOnFirstPages, '.pdf-footer-bar')}
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
    z-index: 0;
  }`
          : ''
  }
  .pdf-body { position: relative; z-index: 1; }
`
}
