import { describe, expect, it } from 'vitest'
import { buildPdfExportCss, pdfPageSizeMm, pdfPrintMarginsMm, resolvePdfExportLayout, resolvePdfPrintOptions } from '@/lib/markdown/export-html-css'
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

    it('justifies only top-level body paragraphs', () => {
        const profile = createDefaultPdfExportProfile()
        profile.typography.justify = true
        expect(buildPdfExportCss(profile)).toContain('.pdf-body > p { text-align: justify; }')
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
        // Every section table fills its (last) page so a short body still pins its footer to the bottom.
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
        expect(css).toContain('.pdf-title-page { height: 100%; min-height: 0; padding-top: 0; justify-content: flex-start; }')
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

        // Blank custom text means there is nothing to show, so no footer is forced on.
        profile.footer.right.text = ' '
        expect(resolvePdfExportLayout(profile).showFooter).toBe(false)
        expect(buildPdfExportCss(profile)).not.toContain('.pdf-page-number')
        profile.footer.right.text = 'Draft'
        expect(resolvePdfExportLayout(profile).showFooter).toBe(true)
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
            expect(css).toContain('.pdf-title-table .pdf-footer-bar { display: none !important; }')
            expect(css).not.toContain('.pdf-toc-table .pdf-footer-bar')
        }
    })
})
