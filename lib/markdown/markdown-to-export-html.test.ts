import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

const EMPTY_ASSETS: PdfExportResolvedAssets = { logoDataUrl: '', header: { left: '', right: '' }, footer: { left: '', right: '' } }

vi.mock('@/lib/mermaid/render', () => ({
    renderMermaidDiagramForExport: vi.fn((source: string) => {
        if (source.includes('FAIL_STRING')) throw 'mermaid string boom'
        if (source.includes('FAIL')) throw new Error('mermaid boom')
        return `<svg data-mermaid="${source.trim()}"></svg>`
    }),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    highlightFencedCode: vi.fn(async (code: string, _lang: string | undefined, theme: string) => {
        if (code.includes('SHIKI_FAIL')) throw new Error('shiki boom')
        return `<pre class="shiki" tabindex="0" data-theme="${theme}"><code>${code}</code></pre>`
    }),
}))

describe('markdownToExportHtml', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('throws when there is nothing to export', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        await expect(markdownToExportHtml('   ')).rejects.toThrow('Nothing to export.')
        await expect(markdownToExportHtml('---\ntitle: X\n---\n')).rejects.toThrow('Nothing to export.')
    })

    it('exports basic markdown with default profile', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const { html } = await markdownToExportHtml('# Hello\n\nParagraph', { tabName: 'hello.md' })
        expect(html).toContain('<title>Hello</title>')
        expect(html).toContain('id="hello"')
        expect(html).toContain('Paragraph')
        expect(html).not.toContain('class="pdf-title-page"')
        expect(html).not.toContain('class="pdf-chrome-table"')
    })

    it('renders title page, toc, chrome, code, mermaid, and assets', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = true
        profile.header.enabled = true
        profile.header.left.text = '{{title}} / {{date}}'
        profile.header.right.text = 'Acme'
        profile.footer.enabled = true
        profile.footer.left.text = 'Footer'
        profile.footer.pageNumbers = 'number'
        profile.brand.accentColor = '#abc123'

        const source = `---
title: Spec
subtitle: Sub
author: Ada
date: Today
---
# Spec

## Section

\`\`\`js
console.log(1)
\`\`\`

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

\`\`\`mermaid
FAIL_STRING
\`\`\`

\`\`\`mermaid
FAIL
\`\`\`

\`\`\`js
SHIKI_FAIL
\`\`\`
`

        const { html } = await markdownToExportHtml(source, {
            profile,
            assets: {
                logoDataUrl: 'data:image/png;base64,logo',
                header: { left: 'data:image/png;base64,hl', right: 'data:image/png;base64,hr' },
                footer: { left: 'data:image/png;base64,fl', right: 'data:image/png;base64,fr' },
            },
        })

        expect(html).toContain('class="pdf-title-page"')
        // Each section is its own chrome table so header/footer rows (and, in bleed mode, margins) repeat on every page.
        const titleTable = html.indexOf('class="pdf-chrome-table pdf-title-table"')
        const tocTable = html.indexOf('class="pdf-chrome-table pdf-toc-table"')
        const bodyTable = html.indexOf('class="pdf-chrome-table pdf-body-table"')
        expect(titleTable).toBeGreaterThan(-1)
        expect(titleTable).toBeLessThan(html.indexOf('class="pdf-title-page"'))
        expect(html.indexOf('class="pdf-title-page"')).toBeLessThan(tocTable)
        expect(tocTable).toBeLessThan(html.indexOf('class="pdf-toc-page"'))
        expect(html.indexOf('class="pdf-toc-page"')).toBeLessThan(bodyTable)
        expect(bodyTable).toBeLessThan(html.indexOf('class="pdf-body"'))
        expect(html.match(/class="pdf-chrome-bar pdf-header-bar"/g)).toHaveLength(3)
        expect(html.match(/class="pdf-chrome-bar pdf-footer-bar"/g)).toHaveLength(3)
        expect(html).toContain('pdf-logo')
        expect(html).toContain('Sub')
        expect(html).toContain('Ada')
        expect(html).toContain('Today')
        expect(html).toContain('class="pdf-toc-page"')
        expect(html).toContain('class="pdf-toc-l2"')
        expect(html).toContain('class="pdf-toc-leader"')
        expect(html).toContain('href="#section"')
        expect(html).toContain('>SFT0001<')
        expect(html).toContain('<h2 id="section"><span class="pdf-heading-mark">SFH0001</span>')
        expect(html).toContain('pdf-chrome-table')
        // Images sit outermost: left image before left text, right text before right image.
        expect(html).toContain(
            '<div class="pdf-chrome-bar pdf-header-bar"><span class="pdf-chrome-side pdf-chrome-left"><img src="data:image/png;base64,hl" alt="" /><span>Spec / Today</span></span><span class="pdf-chrome-side pdf-chrome-right"><span>Acme</span><img src="data:image/png;base64,hr" alt="" /></span></div>'
        )
        expect(html).toContain(
            '<div class="pdf-chrome-bar pdf-footer-bar"><span class="pdf-chrome-side pdf-chrome-left"><img src="data:image/png;base64,fl" alt="" /><span>Footer</span></span><span class="pdf-chrome-side pdf-chrome-right"><span class="pdf-page-number"><span class="pdf-page-number-mark">SFPN</span></span><img src="data:image/png;base64,fr" alt="" /></span></div>'
        )
        expect(html).not.toContain('counter(page)')
        expect(html).toContain('data-theme="github-light"')
        expect(html).toContain('data-mermaid="graph TD; A-->B;"')
        expect(html).toContain('mermaid string boom')
        expect(html).toContain('mermaid boom')
        expect(html).toContain('SHIKI_FAIL')
        expect(html).toContain('#abc123')
    })

    it('puts code blocks and diagrams in place of their paragraph, never inside a <p>', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const source = '# A\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```js\nx\n```\n\n- ```js\n  in a list\n  ```\n\n> ```js\n> quoted\n> ```'
        const { html } = await markdownToExportHtml(source, { assets: EMPTY_ASSETS })
        expect(html).toContain('<div class="mermaid-export pdf-avoid-break"><svg')
        expect(html).toContain('<li><div class="code-block pdf-avoid-break">')
        expect(html).not.toMatch(/<p>\s*<div class="(mermaid-export|code-block)/)
        expect(html).not.toContain('<p></p>')
        expect(html).not.toContain('__SCRIVON_')
    })

    it('renders enabled chrome without optional images or text', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        profile.footer.pageNumbers = 'number'

        const { html } = await markdownToExportHtml('# Only', {
            profile,
            assets: EMPTY_ASSETS,
        })
        expect(html).toContain('pdf-chrome-table')
        expect(html).toContain('pdf-header-bar')
        expect(html).toContain('pdf-page-number')
        expect(html).toContain('SFPN')
        expect(html).not.toContain('counter(page)')
    })

    it('pins a footer shown on every page to the page bottom instead of a table row', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'number'
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = false

        // No title page, so the default "hide on title page" hides nothing: one fixed footer for every page.
        const { html } = await markdownToExportHtml('# A\n\n## B', { profile, assets: EMPTY_ASSETS })
        expect(html.match(/<div class="pdf-fixed-footer"><div class="pdf-chrome-bar pdf-footer-bar">/g)).toHaveLength(1)
        // The table rows stay as invisible copies so the body never runs under the footer.
        expect(html.match(/<tfoot class="pdf-footer-spacer" aria-hidden="true">/g)).toHaveLength(2)
        expect(html.match(/<tfoot>/g)).toBeNull()

        // A footer hidden on the title page can't be a fixed element, which would repeat there too.
        profile.frontMatter.titlePage = true
        const { html: withTitle } = await markdownToExportHtml('# A\n\n## B', { profile, assets: EMPTY_ASSETS })
        expect(withTitle).not.toContain('<div class="pdf-fixed-footer">')
        expect(withTitle).not.toContain('<tfoot class="pdf-footer-spacer"')
        expect(withTitle.match(/<tfoot>/g)).toHaveLength(3)

        profile.footer.hideOnFirstPages = 'none'
        expect((await markdownToExportHtml('# A\n\n## B', { profile, assets: EMPTY_ASSETS })).html).toContain('<div class="pdf-fixed-footer">')

        profile.frontMatter.titlePage = false
        profile.footer.hideOnFirstPages = 'title+toc'
        expect((await markdownToExportHtml('# A\n\n## B', { profile, assets: EMPTY_ASSETS })).html).not.toContain('<div class="pdf-fixed-footer">')
        profile.frontMatter.toc = false
        expect((await markdownToExportHtml('# A\n\n## B', { profile, assets: EMPTY_ASSETS })).html).toContain('<div class="pdf-fixed-footer">')
    })

    it('prints only the page number when the footer switch is off', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.enabled = false
        profile.footer.pageNumbers = 'page-n'
        profile.footer.left.text = 'Confidential'
        profile.footer.backgroundColor = '#e5e7eb'
        profile.footer.textColor = '#ffffff'

        const { html, print } = await markdownToExportHtml('# Only', {
            profile,
            assets: { ...EMPTY_ASSETS, footer: { left: 'data:image/png;base64,fl', right: 'data:image/png;base64,fr' } },
        })
        expect(html).toContain('<span class="pdf-page-number-mark">SFPN</span>')
        expect(html).not.toContain('Confidential')
        expect(html).not.toContain('base64,fl')
        expect(html).not.toContain('base64,fr')
        expect(html).not.toContain('#e5e7eb')
        expect(print.pageNumberColor).toBe('')
    })

    it('keeps footer rows when only the header shows', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        const { html } = await markdownToExportHtml('# Only', { profile, assets: EMPTY_ASSETS })
        expect(html).not.toContain('<div class="pdf-fixed-footer">')
        expect(html).toContain('<tfoot>')
    })

    it('renders a footer bar without the page-number slot when numbering is off', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.enabled = true
        profile.footer.left.text = 'Footer'
        profile.footer.right.text = 'Ignored: the counter owns this slot'
        profile.footer.pageNumbers = 'none'

        const { html } = await markdownToExportHtml('# Only', {
            profile,
            assets: EMPTY_ASSETS,
        })
        expect(html).toContain('pdf-footer-bar')
        expect(html).toContain('<span>Footer</span>')
        expect(html).not.toContain('Ignored')
        expect(html).not.toContain('pdf-page-number')
        expect(html).not.toContain('SFPN')
    })

    it('renders static custom footer text directly but leaves counting templates to the stamper', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = '{{title}} — confidential'

        const source = '---\ntitle: Spec\n---\n# Only'
        const { html: plain } = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(plain).toContain('<span class="pdf-chrome-side pdf-chrome-right"><span>Spec — confidential</span></span>')
        expect(plain).not.toContain('SFPN')

        profile.footer.right.text = 'Page {{page}} of {{total}}'
        const { html: counted } = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(counted).toContain('<span class="pdf-page-number"><span class="pdf-page-number-mark">SFPN</span></span>')
        expect(counted).not.toContain('{{page}}')

        profile.footer.right.text = '   '
        const { html: empty } = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(empty).not.toContain('class="pdf-chrome-table')
    })

    it('tags the html with the document language', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const japanese = '# 写真\n\n骨角器と直線の写真について説明します。'
        expect((await markdownToExportHtml(japanese, { assets: EMPTY_ASSETS })).html).toContain('<html lang="ja">')
        const tagged = `---\nlang: zh-Hant\n---\n${japanese}`
        expect((await markdownToExportHtml(tagged, { assets: EMPTY_ASSETS })).html).toContain('<html lang="zh-Hant">')
        // Code doesn't count: English prose with Chinese code comments is still English.
        const code = '# Setup\n\nRun the script below.\n\n```js\n// 这是一个关于导出文档的很长很长的注释说明\n```'
        expect((await markdownToExportHtml(code, { assets: EMPTY_ASSETS })).html).toContain('<html lang="en">')
    })

    it('leaves the stamper marks out of a print-dialog export and counts pages with CSS instead', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = false
        profile.footer.pageNumbers = 'n-of-total'
        profile.footer.hideOnFirstPages = 'title+toc'

        const { html } = await markdownToExportHtml('# Report\n\n## Section\n\nBody', { profile, assets: EMPTY_ASSETS, stamped: false })
        for (const mark of ['SFPN', 'SFT0', 'SFH0', 'class="pdf-toc-leader"', 'class="pdf-toc-num"', 'pdf-heading-mark"']) {
            expect(html).not.toContain(mark)
        }
        // The TOC still links each heading, it just has no page column.
        expect(html).toContain('<a href="#section"><span class="pdf-toc-title">Section</span></a>')
        expect(html).toContain('content: counter(page) " / " counter(pages);')
        // The sections that hide the footer are a named page without the counter.
        expect(html).toContain('.pdf-title-table, .pdf-toc-table { page: pdf-no-footer; }')
        expect(html).toContain('@page pdf-no-footer { @bottom-right { content: none; } }')
    })

    it('builds the print-dialog counter from a custom template and skips it with no bottom margin', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = 'Sheet {{ page }} of {{total}} - "{{title}}" </style>'
        profile.footer.hideOnFirstPages = 'none'

        const source = '---\ntitle: Spec\n---\n# Only'
        const { html } = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS, stamped: false })
        expect(html).toContain('content: "Sheet " counter(page) " of " counter(pages) " - \\"Spec\\" \\3c /style>";')
        expect(html.match(/<\/style>/g)).toHaveLength(1)
        expect(html).not.toContain('pdf-no-footer')

        profile.footer.enabled = true
        profile.footer.ignoreMargins = true
        const { html: bleed } = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS, stamped: false })
        expect(bleed).not.toContain('counter(page)')
        expect(bleed).not.toContain('SFPN')
    })

    it('wraps title text in a body block and adds the chrome table when only the logo bleeds', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        profile.brand.logoPath = 'C:/brand/cover.png'
        profile.brand.logoIgnoreMargins = true

        const { html } = await markdownToExportHtml('# Cover\n\nBody', {
            profile,
            assets: { ...EMPTY_ASSETS, logoDataUrl: 'data:image/png;base64,logo' },
        })
        expect(html).toContain('<img class="pdf-logo" src="data:image/png;base64,logo" alt="" /><div class="pdf-title-body"><h1>Cover</h1></div>')
        // No header/footer, but the repeating table rows now carry the emulated page margins.
        expect(html).toContain('class="pdf-chrome-table pdf-title-table"')
        expect(html).not.toContain('class="pdf-chrome-table pdf-toc-table"')
        expect(html).toContain('class="pdf-chrome-table pdf-body-table"')
        expect(html).not.toContain('SFPN')
    })

    it('omits empty toc and supports overrides', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.toc = true
        profile.frontMatter.titlePage = true

        const { html } = await markdownToExportHtml('Just text, no headings.', {
            profile,
            overrides: { title: 'Custom', subtitle: '', author: '', date: '' },
        })
        expect(html).toContain('<title>Custom</title>')
        expect(html).toContain('class="pdf-title-page"')
        expect(html).not.toContain('class="pdf-toc-page"')
    })

    it('does not mark a heading that never received an id', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = false
        const { html } = await markdownToExportHtml('# Title\n\n## ![diagram](pic.png)', { profile })
        expect(html).toContain('<h1 id="title">')
        expect(html).toContain('pdf-heading-mark')
        expect(html).toContain('<img')
        expect(html).not.toMatch(/<h2[^>]*pdf-heading-mark/)
    })

    it('gives setext headings ids and ignores hashes inside fenced code', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = false
        const { html } = await markdownToExportHtml('Setext\n======\n\n```bash\n# install deps\n```\n\n## Still', { profile })
        expect(html).toContain('<h1 id="setext">')
        expect(html).toContain('<h2 id="still">')
        expect(html).toContain('href="#setext"')
        expect(html).toContain('href="#still"')
        expect(html).not.toContain('install-deps')
        expect(html).not.toContain('SFT0003')
    })

    it('keeps table column alignment as the align attribute the stylesheet styles', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const { html } = await markdownToExportHtml('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', { assets: EMPTY_ASSETS })
        expect(html).toContain('<td align="left">1</td>')
        expect(html).toContain('<td align="center">2</td>')
        expect(html).toContain('<td align="right">3</td>')
        expect(html).toContain('td[align="right"] { text-align: right; }')
    })

    it('returns the metadata and print options that match the html', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.page.size = 'letter'
        profile.page.orientation = 'landscape'
        profile.footer.enabled = true
        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = '{{title}} · {{page}}/{{total}}'
        profile.footer.textColor = '#ff0000'

        const doc = await markdownToExportHtml('---\ntitle: Spec\n---\n# Hi', { profile, tabName: 'hi.md' })
        expect(doc.metadata.title).toBe('Spec')
        expect(doc.print).toEqual({
            pageWidthMm: 215.9,
            pageHeightMm: 279.4,
            landscape: true,
            marginTopMm: 10,
            marginRightMm: 10,
            marginBottomMm: 10,
            marginLeftMm: 10,
            pageNumberFormat: 'custom:Spec · {{page}}/{{total}}',
            pageNumberColor: '#ff0000',
        })
        expect(doc.html).toContain('SFPN')
    })
})
