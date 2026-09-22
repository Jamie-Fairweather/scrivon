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
        const html = await markdownToExportHtml('# Hello\n\nParagraph', { tabName: 'hello.md' })
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

        const html = await markdownToExportHtml(source, {
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

    it('renders enabled chrome without optional images or text', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.header.enabled = true
        profile.footer.pageNumbers = 'number'

        const html = await markdownToExportHtml('# Only', {
            profile,
            assets: EMPTY_ASSETS,
        })
        expect(html).toContain('pdf-chrome-table')
        expect(html).toContain('pdf-header-bar')
        expect(html).toContain('pdf-page-number')
        expect(html).toContain('SFPN')
        expect(html).not.toContain('counter(page)')
    })

    it('renders a footer bar without the page-number slot when numbering is off', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.footer.enabled = true
        profile.footer.left.text = 'Footer'
        profile.footer.right.text = 'Ignored: the counter owns this slot'
        profile.footer.pageNumbers = 'none'

        const html = await markdownToExportHtml('# Only', {
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
        const plain = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(plain).toContain('<span class="pdf-chrome-side pdf-chrome-right"><span>Spec — confidential</span></span>')
        expect(plain).not.toContain('SFPN')

        profile.footer.right.text = 'Page {{page}} of {{total}}'
        const counted = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(counted).toContain('<span class="pdf-page-number"><span class="pdf-page-number-mark">SFPN</span></span>')
        expect(counted).not.toContain('{{page}}')

        profile.footer.right.text = '   '
        const empty = await markdownToExportHtml(source, { profile, assets: EMPTY_ASSETS })
        expect(empty).not.toContain('class="pdf-chrome-table')
    })

    it('wraps title text in a body block and adds the chrome table when only the logo bleeds', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const profile = createDefaultPdfExportProfile()
        profile.frontMatter.titlePage = true
        profile.brand.logoPath = 'C:/brand/cover.png'
        profile.brand.logoIgnoreMargins = true

        const html = await markdownToExportHtml('# Cover\n\nBody', {
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

        const html = await markdownToExportHtml('Just text, no headings.', {
            profile,
            overrides: { title: 'Custom', subtitle: '', author: '', date: '' },
        })
        expect(html).toContain('<title>Custom</title>')
        expect(html).toContain('class="pdf-title-page"')
        expect(html).not.toContain('class="pdf-toc-page"')
    })

    it('skips ids for setext headings missing from the ATX outline', async () => {
        const { markdownToExportHtml } = await import('@/lib/markdown/markdown-to-export-html')
        const html = await markdownToExportHtml('Setext\n======\n\n## Still')
        expect(html).toContain('id="still"')
    })
})
