import { describe, expect, it } from 'vitest'
import {
    applyPdfFooterSwitch,
    buildPdfExportCss,
    pdfBodyHeightMm,
    PDF_STAMP_GLYPHS_CLASS,
    pdfPageSizeMm,
    pdfPrintMarginsMm,
    pdfStampGlyphText,
    resolvePdfExportLayout,
    resolvePdfPrintOptions,
} from '@/lib/markdown/export-html-css'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'

describe('buildPdfExportCss', () => {
    it('emits page size, fonts, brand colour, and default margins', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        expect(css).toContain('size: A4;')
        expect(css).toContain('margin: 10mm 10mm 10mm 10mm;')
        expect(css).toContain('min-height: 237mm;')
        expect(css).toContain('color: #262626;')
        expect(css).not.toContain('break-before: page')
        expect(css).not.toContain('content: "DRAFT"')
        expect(css).not.toContain('text-align: justify')
    })

    it('wraps long code lines instead of cutting them off at the box edge', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        for (const selector of ['.code-block pre.shiki {', '.code-block pre:not(.shiki) {']) {
            const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
            expect(rule).toContain('white-space: pre-wrap;')
            expect(rule).toContain('overflow-wrap: anywhere;')
            expect(rule).not.toContain('overflow-x: auto')
        }
    })

    it('keeps wide content from stretching the page past its width', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'number'
        const css = buildPdfExportCss(profile)
        // The section table can't grow to fit its widest line, and long words break instead of overflowing.
        expect(css).toMatch(/\.pdf-chrome-table \{\s*width: 100%;\s*border-collapse: collapse;\s*table-layout: fixed;/)
        expect(css).toMatch(/\.export-article \{[^}]*overflow-wrap: anywhere;/)
        // Table cells must not shrink below their longest word, or short columns break mid-word.
        expect(css).toMatch(/table:not\(\.pdf-chrome-table\) td \{[^}]*overflow-wrap: break-word;/)
        // ...except in a table too wide for the page, which would otherwise shrink every page.
        expect(css).toMatch(
            /table:not\(\.pdf-chrome-table\) \.pdf-long-word,\s*table\.pdf-wide-table:not\(\.pdf-chrome-table\) th,\s*table\.pdf-wide-table:not\(\.pdf-chrome-table\) td \{ overflow-wrap: anywhere; \}/
        )
        expect(css.indexOf('.pdf-long-word')).toBeGreaterThan(css.indexOf('overflow-wrap: break-word;'))
    })

    it('fits body images to the text width and to one page', () => {
        const profile = createDefaultPdfExportProfile()
        // A4 portrait: 297 - 10 - 10, less a little slack.
        expect(buildPdfExportCss(profile)).toMatch(/\.pdf-body img \{\s*max-width: 100%;\s*max-height: 271mm;\s*object-fit: contain;\s*\}/)

        // Header and footer bars take room from the page, so the cap shrinks.
        profile.header.enabled = true
        profile.header.heightMm = 20
        profile.header.gapMm = 4
        profile.footer.pageNumbers = 'number'
        expect(buildPdfExportCss(profile)).toContain('max-height: 235mm;')

        profile.page.orientation = 'landscape'
        expect(buildPdfExportCss(profile)).toContain('max-height: 148mm;')
    })

    it('keeps the size raw HTML gives an image, which any width or height rule would override (N30)', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile()).replace(/\/\*[\s\S]*?\*\//g, '')
        const rules = [...css.matchAll(/([^{}]*\.pdf-body img[^{}]*)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
            selectors: selectors!.trim(),
            body: body!,
        }))
        expect(rules.length).toBeGreaterThan(0)
        // No rule sets a width, so <img width="120"> prints 120px wide.
        for (const { body } of rules) expect(body).not.toMatch(/(^|[\s;])width:/)
        // The height follows the width, unless the document gave a height and no width.
        expect(rules.find(({ body }) => /height: auto/.test(body))?.selectors).toBe('.pdf-body img[width], .pdf-body img:not([height])')
    })

    it('gives body images the room the settings report when a bar ignores the margins', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header = { ...profile.header, enabled: true, heightMm: 0, gapMm: 0, ignoreMargins: true }
        profile.footer = { ...profile.footer, enabled: true, heightMm: 20, gapMm: 0, ignoreMargins: true }
        // Each bar sits in its 10mm margin band and only pushes the text past it: 297 - 12 - 20.
        expect(pdfBodyHeightMm(profile)).toBe(265)
        const css = buildPdfExportCss(profile)
        expect(css).toMatch(/\.pdf-body img \{\s*max-width: 100%;\s*max-height: 259mm;/)
        expect(css).toMatch(/\.mermaid-export svg \{[^}]*max-height: 251mm;/)
    })

    it('shrinks a diagram taller than a page to fit on one page', () => {
        const profile = createDefaultPdfExportProfile()
        // The body image room (271mm on A4 portrait), less the diagram box's padding and border.
        expect(buildPdfExportCss(profile)).toMatch(/\.mermaid-export svg \{[^}]*max-width: 100%;\s*max-height: 263mm;\s*width: auto;\s*height: auto;/)

        // Landscape A4 with a page-number footer: 210 - 10 - 10 - 12 (auto bar) - 6 - 8.
        profile.page.orientation = 'landscape'
        profile.footer.pageNumbers = 'number'
        expect(buildPdfExportCss(profile)).toMatch(/\.mermaid-export svg \{[^}]*max-height: 164mm;/)
    })

    it('keeps the title page on one sheet, shrinking the logo to fit', () => {
        const titleRule = (css: string) => css.slice(css.indexOf('.pdf-title-page {'), css.indexOf('}', css.indexOf('.pdf-title-page {')))
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        // A4 portrait: the classic 297 - 20 - 40, growing up to the printable height less slack.
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/min-height: 237mm;\s*max-height: 273mm;/)
        const css = buildPdfExportCss(profile)
        expect(css).toMatch(/\.pdf-title-page \.pdf-logo \{[^}]*flex: 0 1 auto;\s*min-height: 0;/)
        expect(css).toMatch(/\.pdf-title-body \{[^}]*flex: 0 0 auto;/)

        // Landscape: the sheet's short side is the height.
        profile.page.orientation = 'landscape'
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/min-height: 150mm;\s*max-height: 186mm;/)

        // A footer hidden on the cover is covered there, by a copy as tall as it: 297 - 10 - (10 + 12) - 4.
        profile.page.orientation = 'portrait'
        profile.footer.pageNumbers = 'number'
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/min-height: 237mm;\s*max-height: 261mm;/)
        profile.footer.pageNumbers = 'none'

        // Large margins.
        profile.page.marginsMm = { top: 50, right: 30, bottom: 50, left: 30 }
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/min-height: 157mm;\s*max-height: 193mm;/)

        // 30mm bars shown on the cover: 297 - (10 + 30) - (10 + 30) - 4.
        profile.page.marginsMm = { top: 10, right: 10, bottom: 10, left: 10 }
        for (const chrome of [profile.header, profile.footer]) {
            chrome.enabled = true
            chrome.heightMm = 30
            chrome.hideOnFirstPages = 'none'
        }
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/min-height: 213mm;\s*max-height: 213mm;/)

        // A bar that ignores margins sits in the margin band, so only its overflow counts: 297 - 30 - 30 - 4.
        profile.header.ignoreMargins = true
        profile.footer.ignoreMargins = true
        expect(titleRule(buildPdfExportCss(profile))).toMatch(/max-height: 233mm;/)
    })

    it('only keeps marked blocks and diagrams whole, not every code block and table', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        const print = css.slice(css.indexOf('@media print'), css.indexOf('.export-article {'))
        expect(print).toMatch(/\.pdf-avoid-break,\s*\.mermaid-export \{\s*break-inside: avoid;/)
        expect(print).not.toMatch(/\.code-block[,\s{]/)
        expect(print).not.toContain('table:not(.pdf-chrome-table)')
    })

    it('keeps body headings with the content that follows them', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        const print = css.slice(css.indexOf('@media print'))
        expect(print).toMatch(
            /\.pdf-body h1, \.pdf-body h2, \.pdf-body h3, \.pdf-body h4, \.pdf-body h5, \.pdf-body h6 \{\s*break-after: avoid;\s*page-break-after: avoid;/
        )
    })

    it('raises the toc leader without a transform, which bloats every pdf page', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        const rule = css.slice(css.indexOf('.pdf-toc-leader {'), css.indexOf('}', css.indexOf('.pdf-toc-leader {')))
        expect(rule).toContain('position: relative;')
        expect(rule).toContain('top: -0.25em;')
        expect(rule).not.toContain('transform')
    })

    it('sizes headings, the title and code relative to the body size', () => {
        const profile = createDefaultPdfExportProfile()
        profile.typography.bodySizePt = 16
        const css = buildPdfExportCss(profile)
        expect(css).toContain('font-size: 16pt;')
        // em follows the body size; rem would stay at the browser's 16px root whatever the setting.
        const sizes = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => {
            const match = css.match(new RegExp(`\\n\\s*${tag} \\{[^}]*font-size: ([\\d.]+)em;`))
            expect(match, tag).not.toBeNull()
            return Number(match![1])
        })
        expect(sizes.slice(0, 5).every((size) => size >= 1)).toBe(true)
        expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)
        expect(css).not.toMatch(/font-size: [\d.]+rem/)
        expect(css).not.toMatch(/\.code-block pre[^{]*\{[^}]*font-size: 12px/)
        expect(css).toMatch(/\.pdf-title-page h1 \{[^}]*font-size: [\d.]+em;/)
        expect(css).toMatch(/\.pdf-toc-page h1 \{[^}]*font-size: [\d.]+em;/)
    })

    it('puts a bulleted task’s checkbox in place of its bullet, and keeps a numbered task’s number (N32)', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        expect(css).toContain('ul > li.task-list-item { list-style: none; }')
        // No rule takes the number off a numbered task.
        expect(css).not.toMatch(/(^|[\n,])\s*(ol > )?li\.task-list-item \{[^}]*list-style/)
        // The box moves back into the bullet's place, in a tight list or the first paragraph of a loose one.
        expect(css).toMatch(
            /ul > li\.task-list-item > input\[type="checkbox"\],\s*ul > li\.task-list-item > p:first-child > input\[type="checkbox"\] \{ margin-inline-start: -1\.25rem; \}/
        )
        expect(css).toMatch(
            /\n\s*li\.task-list-item > input\[type="checkbox"\],\s*li\.task-list-item > p:first-child > input\[type="checkbox"\] \{ margin-block: 0; margin-inline: 0 0\.25rem; vertical-align: middle; \}/
        )
    })

    it('honours markdown table column alignment', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        expect(css).not.toMatch(/table:not\(\.pdf-chrome-table\) td \{[^}]*text-align: left;/)
        expect(css).toMatch(/table:not\(\.pdf-chrome-table\) td \{[^}]*text-align: start;/)
        for (const align of ['left', 'center', 'right']) {
            expect(css).toContain(`table:not(.pdf-chrome-table) td[align="${align}"] { text-align: ${align}; }`)
        }
    })

    it('indents lists, quotes and TOC levels from the start side, so Arabic and Hebrew indent on the right', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        // The list has no direction of its own, so the indent goes on each item, which has one.
        expect(css).toContain('ul, ol { margin: 0 0 0.75rem; padding-inline-start: 0; }')
        expect(css).toContain('li { margin: 0.25rem 0; margin-inline-start: 1.25rem; word-break: break-word; }')
        // The Contents rows keep no indent of their own.
        expect(css).toMatch(/\.pdf-toc-list li \{\s*margin: 0;/)
        expect(css).toMatch(/blockquote \{[^}]*padding-inline-start: 1rem;[^}]*border-inline-start: 2px solid #[0-9a-f]+;/i)
        expect(css).not.toMatch(/blockquote \{[^}]*(padding|border)-left/)
        expect(css).toContain('.pdf-toc-l2 a { padding-inline-start: 1rem; }')
        expect(css).toContain('.pdf-toc-l3 a { padding-inline-start: 2rem;')
        expect(css).toContain('.pdf-toc-l4 a { padding-inline-start: 3rem;')
        expect(css).not.toMatch(/\.pdf-toc-l\d a \{[^}]*padding-left/)
    })

    it('fixes the footer to the page bottom, hides its table copies and covers it where it hides (U04, N29)', () => {
        const profile = createDefaultPdfExportProfile()
        const css = buildPdfExportCss(profile)
        expect(css).toContain('.pdf-fixed-footer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2; }')
        expect(css).toContain('.pdf-footer-spacer { visibility: hidden; }')
        // The cover is opaque and drawn over the fixed footer (z-index 2), but its copy of the bar isn't.
        expect(css).toContain('.pdf-footer-cover > tr > td { position: relative; z-index: 3; background: #ffffff; }')
        expect(css).toContain('.pdf-footer-cover .pdf-chrome-bar { visibility: hidden; }')
        // The anchor fills the first page of its section, from the top of the section's table, bar at its foot.
        expect(css).toMatch(/\.pdf-chrome-table \{\s*height: 100vh;\s*position: relative;\s*\}/)
        expect(css).toMatch(
            /\.pdf-fixed-footer\.pdf-footer-anchor \{\s*position: absolute;\s*top: 0;\s*bottom: auto;\s*height: 100vh;\s*display: flex;\s*flex-direction: column;\s*justify-content: flex-end;\s*visibility: hidden;\s*\}/
        )
        // Printer margins already place the page bottom; nothing to emulate.
        expect(css).not.toMatch(/\.pdf-fixed-footer \{ (padding|min-height)/)
        expect(css).not.toContain('.pdf-page-number-mark')

        // Only the anchor draws its page-number marker once the fixed footer's is switched off.
        profile.footer.pageNumbers = 'number'
        const numbered = buildPdfExportCss(profile)
        expect(numbered).toContain('.pdf-footer-anchor .pdf-page-number-mark { visibility: visible; }')
        expect(numbered).toContain('.pdf-footer-unmarked .pdf-page-number-mark { visibility: hidden; }')
    })

    it('puts the fixed footer in the emulated bottom margin when printing edge to edge', () => {
        const profile = createDefaultPdfExportProfile()
        profile.page.marginsMm = { top: 12, right: 15, bottom: 14, left: 13 }
        profile.header.enabled = true
        profile.header.ignoreMargins = true
        profile.footer.pageNumbers = 'number'
        expect(buildPdfExportCss(profile)).toContain('.pdf-fixed-footer { padding: 0 15mm 14mm 13mm; }')

        profile.footer.ignoreMargins = true
        expect(buildPdfExportCss(profile)).toContain(
            '.pdf-fixed-footer { min-height: 14mm; display: flex; flex-direction: column; justify-content: flex-end; }'
        )
    })

    it('justifies only top-level body paragraphs, leaving one its HTML aligns as it is (N33)', () => {
        const profile = createDefaultPdfExportProfile()
        profile.typography.justify = true
        const css = buildPdfExportCss(profile)
        expect(css).toContain('.pdf-body > p:not([align]) { text-align: justify; }')
        expect(css).not.toContain('.pdf-body > p {')
    })

    it('applies letter landscape, link fallback, chrome, watermark, and heading breaks', () => {
        const profile = createDefaultPdfExportProfile()
        profile.page.size = 'letter'
        profile.page.orientation = 'landscape'
        profile.brand.accentColor = '#112233'
        profile.brand.linkColor = ''
        profile.flow.newPageFromHeading = 2
        profile.content.watermark = 'DRAFT "x"'
        profile.header.enabled = true
        profile.header.backgroundColor = '#eee'
        profile.header.hideOnFirstPages = 'title+toc'
        profile.footer.enabled = true
        profile.footer.pageNumbers = 'page-n'
        profile.footer.backgroundColor = '#ddd'
        profile.footer.hideOnFirstPages = 'none'
        profile.brand.linkColor = '#abcdef'

        const css = buildPdfExportCss(profile)
        expect(css).toContain('size: letter landscape;')
        expect(css).toContain('.pdf-body h1, .pdf-body h2 { break-before: page;')
        expect(css).toContain('.pdf-body > :is(h1, h2):first-child')
        expect(css).toContain('.pdf-title-page {')
        expect(css).toMatch(/\.pdf-title-page[^{]*\{[^}]*page-break-after:\s*always/)
        expect(css).not.toContain('border-top: 4px solid')
        expect(css).toContain('.pdf-title-page .pdf-logo')
        expect(css).toContain('max-height: 150mm')
        expect(css).toContain('object-fit: contain')
        expect(css).toContain('color: #abcdef;')
        expect(css).toContain('background: #eee;')
        expect(css).toContain('background: #ddd;')
        expect(css).not.toContain('counter(page)')
        expect(css).toMatch(/\.pdf-page-number \{ min-width: [\d.]+em; text-align: right;/)
        expect(css).not.toContain('@bottom-right')
        expect(css).toContain('.pdf-title-table .pdf-header-bar, .pdf-toc-table .pdf-header-bar { display: none !important; }')
        expect(css).not.toContain('.pdf-title-table .pdf-footer-bar')
        expect(css).toMatch(/\.pdf-title-table,\s*\.pdf-toc-table \{\s*break-after: page;/)
        expect(css).toMatch(/\.pdf-title-table \.pdf-title-page,\s*\.pdf-toc-table \.pdf-toc-page \{\s*break-after: auto;/)
        // A one-page section fills its page, so the title page centres on it with its footer row at the bottom.
        expect(css).toMatch(/\.pdf-chrome-table \{\s*height: 100vh;/)
        expect(css).toContain('.pdf-body-table > tbody > tr > td { vertical-align: top; }')
        // Letter landscape: 215.9 - 10 - 10 - 40
        expect(css).toContain('min-height: 156mm;')
        expect(css).toContain('content: "DRAFT \\"x\\""')
    })

    it('keeps printer margins and omits bleed rules when nothing ignores margins', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header.ignoreMargins = true // header is disabled, so this must not trigger bleed
        profile.brand.logoIgnoreMargins = true // no logo path / title page
        expect(resolvePdfExportLayout(profile).bleed).toBe(false)
        expect(pdfPrintMarginsMm(profile)).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
        const css = buildPdfExportCss(profile)
        expect(css).toContain('margin: 10mm 10mm 10mm 10mm;')
        expect(css).not.toContain('.pdf-chrome-table > tbody > tr > td')
    })

    it('applies chrome height, gap, and font colour', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        profile.header.heightMm = 18
        profile.header.gapMm = 6
        profile.header.textColor = '#ffffff'
        profile.footer.enabled = true
        profile.footer.gapMm = 4
        profile.footer.textColor = ' #ff0000 '
        const css = buildPdfExportCss(profile)
        expect(css).toMatch(/\.pdf-header-bar \{[^}]*height: 18mm;/)
        expect(css).toMatch(/\.pdf-header-bar \{[^}]*margin-bottom: 6mm;/)
        expect(css).toMatch(/\.pdf-header-bar \{[^}]*color: #ffffff;/)
        expect(css).toMatch(/\.pdf-footer-bar \{[^}]*margin-top: 4mm;/)
        expect(css).toMatch(/\.pdf-footer-bar \{[^}]*color: #ff0000;/)
        expect(css).not.toMatch(/\.pdf-footer-bar \{[^}]*height:/)
        expect(buildPdfExportCss(createDefaultPdfExportProfile())).not.toMatch(/\.pdf-(header|footer)-bar \{[^}]*margin-/)
    })

    it('reports the portrait sheet size for the print engine', () => {
        const profile = createDefaultPdfExportProfile()
        expect(pdfPageSizeMm(profile)).toEqual({ width: 210, height: 297 })
        profile.page.size = 'letter'
        profile.page.orientation = 'landscape'
        expect(pdfPageSizeMm(profile)).toEqual({ width: 215.9, height: 279.4 })
    })

    it('hands custom counting templates to the stamper with document placeholders filled', () => {
        const metadata = { title: 'Spec', subtitle: '', author: '', date: '' }
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = '{{title}} · {{page}}/{{total}}'
        expect(resolvePdfPrintOptions(profile, metadata).pageNumberFormat).toBe('custom:Spec · {{page}}/{{total}}')

        // Static custom text is ordinary footer HTML; nothing for the stamper to do.
        profile.footer.right.text = 'Confidential'
        expect(resolvePdfPrintOptions(profile, metadata).pageNumberFormat).toBe('none')

        profile.footer.pageNumbers = 'n-of-total'
        profile.footer.textColor = ' #ff0000 '
        expect(resolvePdfPrintOptions(profile, metadata)).toMatchObject({ pageNumberFormat: 'n-of-total', pageNumberColor: '#ff0000' })
    })

    it("hands the author and subtitle over for the PDF's document properties", () => {
        const profile = createDefaultPdfExportProfile()
        expect(resolvePdfPrintOptions(profile, { title: 'Spec', subtitle: ' Q3 figures ', author: ' Zoë Ångström ', date: '' })).toMatchObject({
            author: 'Zoë Ångström',
            subject: 'Q3 figures',
        })

        // Unset ones are left out, so the PDF gets no empty properties.
        const options = resolvePdfPrintOptions(profile, { title: 'Spec', subtitle: '  ', author: '', date: '2026-11-07' })
        expect(options).not.toHaveProperty('author')
        expect(options).not.toHaveProperty('subject')
    })

    it('zeroes the print margins when the css emulates them', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        profile.header.ignoreMargins = true
        const options = resolvePdfPrintOptions(profile, { title: '', subtitle: '', author: '', date: '' })
        expect(options).toMatchObject({ marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, landscape: false })
    })

    it('prints with zero margins and emulates them when the header bleeds', () => {
        const profile = createDefaultPdfExportProfile()
        profile.page.marginsMm = { top: 12, right: 15, bottom: 14, left: 13 }
        profile.header.enabled = true
        profile.header.ignoreMargins = true
        profile.footer.pageNumbers = 'number'

        const layout = resolvePdfExportLayout(profile)
        expect(layout).toMatchObject({ bleed: true, headerBleeds: true, footerBleeds: false, logoBleeds: false })
        expect(pdfPrintMarginsMm(profile)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })

        const css = buildPdfExportCss(profile)
        expect(css).toContain('margin: 0mm 0mm 0mm 0mm;')
        expect(css).toContain('.pdf-chrome-table > thead > tr > td { padding: 0; height: 12mm; vertical-align: top; }')
        expect(css).toContain('.pdf-chrome-table > tbody > tr > td { padding: 0 15mm 0 13mm; }')
        expect(css).toContain('.pdf-chrome-table > tfoot > tr > td { padding: 0 15mm 14mm 13mm; vertical-align: bottom; }')
        expect(css).toMatch(/\.pdf-header-bar \{[^}]*padding-left: 13mm; padding-right: 15mm;/)
        expect(css).not.toMatch(/\.pdf-footer-bar \{[^}]*padding-left/)
        // Sections get their margins from the table cells, never from padding that would vanish at a page split.
        expect(css).not.toMatch(/\.pdf-toc-page \{ padding/)
        expect(css).not.toContain('.pdf-title-body { flex: 1 0 auto;')
        expect(css).not.toContain('.pdf-title-table > thead')
    })

    it('bleeds the footer band and the title-page image', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.enabled = true
        profile.footer.ignoreMargins = true
        profile.frontMatter.titlePage = true
        profile.brand.logoPath = 'C:/brand/cover.png'
        profile.brand.logoIgnoreMargins = true

        const layout = resolvePdfExportLayout(profile)
        expect(layout).toMatchObject({ bleed: true, headerBleeds: false, footerBleeds: true, logoBleeds: true })

        const css = buildPdfExportCss(profile)
        expect(css).toContain('.pdf-chrome-table > thead > tr > td { padding: 10mm 10mm 0 10mm; vertical-align: top; }')
        expect(css).toContain('.pdf-chrome-table > tfoot > tr > td { padding: 0; height: 10mm; vertical-align: bottom; }')
        // No header on the cover: drop the top-margin spacer so the image reaches the page edge,
        // and let the section fill the cell so the title centres in the space below the image.
        expect(css).toContain('.pdf-title-table > thead > tr > td { padding: 0; height: auto; }')
        expect(css).toContain('.pdf-title-table > tbody > tr > td { vertical-align: top; }')
        // The image starts at the sheet's top edge; only the footer's band (covered, as the cover hides the footer) and slack come off.
        expect(css).toContain('.pdf-title-page { height: 281mm; min-height: 0; max-height: none; padding-top: 0; justify-content: flex-start; }')
        expect(css).toContain('width: calc(100% + 20mm);')
        expect(css).toContain('margin: 0 -10mm 0 -10mm;')
        expect(css).toMatch(/\.pdf-title-page \.pdf-logo \{[^}]*max-width: none;[^}]*object-fit: cover;/)
        expect(css).toContain('.pdf-title-body { flex: 1 0 auto; justify-content: center; padding-top: 10mm; }')
    })

    it('keeps the header cell when a header shows on the cover above a bleeding image', () => {
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        profile.brand.logoPath = 'C:/brand/cover.png'
        profile.brand.logoIgnoreMargins = true
        profile.header.enabled = true
        profile.header.left.text = 'Acme'
        profile.header.hideOnFirstPages = 'none'

        const css = buildPdfExportCss(profile)
        // The header keeps its normal margin rules; the image simply follows it.
        expect(css).not.toContain('.pdf-title-table > thead')
        expect(css).toContain('.pdf-chrome-table > thead > tr > td { padding: 10mm 10mm 0 10mm; vertical-align: top; }')
        expect(css).toContain('.pdf-title-table > tbody > tr > td { vertical-align: top; }')
    })

    it('sizes the page-number slot for the label the stamper will draw', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'number'
        expect(buildPdfExportCss(profile)).toContain('.pdf-page-number { min-width: 4.4em;')
        profile.footer.pageNumbers = 'n-of-total'
        expect(buildPdfExportCss(profile)).toContain('.pdf-page-number { min-width: 5.0em;')

        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = 'Page {{page}} of {{total}} — {{title}}'
        // "Page 000 of 000 —" = 17 chars × 0.55em
        expect(buildPdfExportCss(profile)).toContain('.pdf-page-number { min-width: 9.4em;')

        // The filled-in title is part of the stamped label, so it needs room too: "Quarterly Report · 000/000" = 26 chars.
        profile.footer.right.text = '{{title}} · {{page}}/{{total}}'
        const meta = (title: string) => ({ title, subtitle: '', author: '', date: '' })
        expect(buildPdfExportCss(profile, meta('Quarterly Report'))).toContain('.pdf-page-number { min-width: 14.3em;')
        // A title the stamper can't draw is ordinary footer text beside the slot, which then only holds "000/000".
        expect(buildPdfExportCss(profile, meta('Отчёт о продажах'))).toContain('.pdf-page-number { min-width: 3.9em;')

        // Blank custom text means there is nothing to show, so no footer is forced on.
        profile.footer.right.text = ' '
        expect(resolvePdfExportLayout(profile).showFooter).toBe(false)
        expect(buildPdfExportCss(profile)).not.toContain('.pdf-page-number')
        profile.footer.right.text = 'Draft'
        expect(resolvePdfExportLayout(profile).showFooter).toBe(true)
    })

    it('keeps only the page number of a footer that is switched off', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.enabled = false
        profile.footer.pageNumbers = 'custom'
        profile.footer.left = { text: 'Confidential', imagePath: 'C:/left.png' }
        profile.footer.right = { text: 'Page {{page}}', imagePath: 'C:/right.png' }
        profile.footer.backgroundColor = '#1f2937'
        profile.footer.textColor = '#ffffff'
        profile.footer.heightMm = 20
        profile.footer.gapMm = 5
        profile.footer.ignoreMargins = true

        const shown = applyPdfFooterSwitch(profile)
        expect(shown.footer).toMatchObject({
            left: { text: '', imagePath: '' },
            right: { text: 'Page {{page}}', imagePath: '' },
            backgroundColor: '',
            textColor: '',
            heightMm: 0,
            gapMm: 0,
            ignoreMargins: false,
            pageNumbers: 'custom',
        })
        expect(resolvePdfExportLayout(shown)).toMatchObject({ showFooter: true, footerBleeds: false, bleed: false })
        // White numbers from a dark footer would vanish on bare paper, so the stamp uses its default colour.
        expect(resolvePdfPrintOptions(shown, { title: '', subtitle: '', author: '', date: '' })).toMatchObject({
            pageNumberFormat: 'custom:Page {{page}}',
            pageNumberColor: '',
        })
        const css = buildPdfExportCss(shown)
        expect(css).not.toContain('#1f2937')
        expect(css).not.toMatch(/\.pdf-footer-bar \{[^}]*(height|margin-top|padding-left):/)

        profile.footer.enabled = true
        expect(applyPdfFooterSwitch(profile)).toBe(profile)
    })

    it('lets images fill a fixed-height bar', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        profile.header.heightMm = 20
        const css = buildPdfExportCss(profile)
        expect(css).toContain('.pdf-header-bar img { max-height: calc(20mm - 0.7rem); }')
        expect(css).not.toContain('.pdf-footer-bar img')
        // Both groups exist and the right one hugs the page edge.
        expect(css).toContain('.pdf-chrome-right { justify-content: flex-end; text-align: right; }')
    })

    it('covers page number formats and hide selectors', () => {
        for (const format of ['number', 'n-of-total', 'none'] as const) {
            const profile = createDefaultPdfExportProfile()
            profile.footer.pageNumbers = format
            profile.header.hideOnFirstPages = 'none'
            profile.footer.hideOnFirstPages = 'title'
            const css = buildPdfExportCss(profile)
            expect(css).not.toContain('counter(page)')
            if (format === 'none') {
                expect(css).not.toContain('.pdf-page-number')
            } else {
                expect(css).toMatch(/\.pdf-page-number \{ min-width: [\d.]+em; text-align: right;/)
            }
            expect(css).not.toContain('@bottom-right')
            expect(css).not.toContain('.pdf-title-table .pdf-header-bar { display: none')
            // The footer is fixed and covered where it hides, so its copy there keeps its size.
            expect(css).not.toContain('.pdf-footer-bar { display: none')
        }
    })
})

describe('marker transparency the stamper relies on', () => {
    /** Declarations of every rule whose selector list names `className`. */
    function rulesFor(css: string, className: string): string[] {
        return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .filter(([, selectors]) => selectors!.split(',').some((selector) => selector.trim() === `.${className}`))
            .map(([, , declarations]) => declarations!)
    }

    it('draws every marker nearly, but not fully, transparent', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'number'
        profile.frontMatter.toc = true
        const css = buildPdfExportCss(profile)
        // src-tauri/src/page_numbers.rs only treats text below MARKER_MAX_ALPHA (0.05) as a marker and cuts it
        // out of the PDF's text; fully transparent text may not be drawn at all, which loses the page numbers.
        for (const className of ['pdf-page-number-mark', 'pdf-toc-mark', 'pdf-heading-mark', PDF_STAMP_GLYPHS_CLASS]) {
            const rules = rulesFor(css, className)
            expect(rules.length, className).toBeGreaterThan(0)
            const alphas = rules.flatMap((rule) =>
                [...rule.matchAll(/color:\s*rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g)].map((match) => Number(match[1]))
            )
            expect(alphas, className).toHaveLength(1)
            expect(alphas[0], className).toBeGreaterThan(0)
            expect(alphas[0], className).toBeLessThan(0.05)
            for (const rule of rules) {
                expect(rule, className).not.toMatch(/opacity|transparent/)
            }
        }
    })
})

describe('glyph samples for the stamper', () => {
    it('lists every character a label can use, each once, with any space between digits', () => {
        expect(pdfStampGlyphText('number')).toBe('0123456789')
        expect(pdfStampGlyphText('page-n')).toBe('01234 56789Page')
        expect(pdfStampGlyphText('n-of-total')).toBe('01234 56789/')
        expect(pdfStampGlyphText('custom:{{page}} из {{ total }}')).toBe('01234 56789из')
        expect(pdfStampGlyphText('custom:{{page}}/{{total}}页')).toBe('0123456789/页')
        expect(pdfStampGlyphText('custom:Seite {{page}} von {{total}}, Seite 2')).toBe('01234 56789Seitvon,')
        expect(pdfStampGlyphText('custom:{{page}}')).toBe('0123456789')
    })

    it('has nothing to sample when no label is drawn', () => {
        expect(pdfStampGlyphText('none')).toBe('')
        expect(pdfStampGlyphText('constructor')).toBe('')
    })

    it('draws the sample tiny and see-through, taking no room and not clipped', () => {
        const css = buildPdfExportCss(createDefaultPdfExportProfile())
        const start = css.indexOf(`.${PDF_STAMP_GLYPHS_CLASS} {`)
        expect(start).toBeGreaterThan(-1)
        const rule = css.slice(start, css.indexOf('}', start))
        expect(rule).toContain('width: 0;')
        expect(rule).toContain('white-space: pre;')
        // Under 1pt and nearly transparent: page_numbers.rs cuts such text back out (SAMPLE_MAX_FONT_SIZE).
        expect(rule).toContain('font-size: 1px;')
        expect(rule).toContain('color: rgba(64, 64, 64, 0.01);')
        expect(rule).not.toContain('overflow: hidden')
    })
})
