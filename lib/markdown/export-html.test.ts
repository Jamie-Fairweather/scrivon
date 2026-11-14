/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExportDocument } from '@/lib/markdown/export-document'
import { PDF_PAGE_NUMBER_MARK } from '@/lib/markdown/export-html-css'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { exportMarkdown } from '@/lib/markdown/export-pdf'
import { renderExportHtml } from './export-html'

vi.mock('@/lib/mermaid/render', () => ({
    renderMermaidDiagramForExport: vi.fn((source: string) => `<svg data-mermaid="${source.trim()}" viewBox="0 0 100 50"></svg>`),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    highlightFencedCode: vi.fn(async (code: string) => `<pre class="shiki"><code>${code}</code></pre>`),
}))

const pickSavePath = vi.hoisted(() => vi.fn<(options: { title?: string; defaultPath?: string }) => Promise<string | null>>())
const writeTextFileAtPath = vi.hoisted(() => vi.fn<(path: string, content: string) => Promise<void>>(async () => undefined))
const isTauri = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/tauri/dialog', () => ({ pickSavePath, writeTextFileAtPath, writeBinaryFile: vi.fn() }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri, isWindowsTauri: isTauri }))

/** A profile with everything a page can have: header, footer, page numbers, a title page and contents. */
function fullProfile() {
    const profile = createDefaultPdfExportProfile()
    profile.header.enabled = true
    profile.header.left.text = 'ACME-HEADER'
    profile.footer.enabled = true
    profile.footer.left.text = 'ACME-FOOTER'
    profile.footer.pageNumbers = 'n-of-total'
    return profile
}

describe('renderExportHtml', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('builds a web page with the text and its own styles, and nothing loaded from elsewhere', async () => {
        const html = await renderExportHtml(buildExportDocument('# Plan\n\nHello there', { tabName: 'plan.md', profile: fullProfile() }))
        expect(html).toMatch(/^<!DOCTYPE html>/)
        expect(html).toContain('<title>Plan</title>')
        expect(html).toContain('Hello there')
        expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
        expect(html).toContain('<style>')
        expect(html).not.toMatch(/<script|<link\b/)
    })

    it('leaves out the PDF page header, footer and page numbers', async () => {
        const html = await renderExportHtml(buildExportDocument('# Plan\n\nHello there', { tabName: 'plan.md', profile: fullProfile() }))
        expect(html).not.toContain('ACME-HEADER')
        expect(html).not.toContain('ACME-FOOTER')
        expect(html).not.toContain('class="pdf-chrome-table')
        expect(html).not.toContain(PDF_PAGE_NUMBER_MARK)
        expect(html).not.toContain('counter(page)')
    })

    it('keeps the title page, and the contents as links to the headings', async () => {
        const profile = fullProfile()
        profile.frontMatter.titlePage = true
        profile.frontMatter.toc = true
        profile.frontMatter.tocExcludeH1 = false
        const html = await renderExportHtml(buildExportDocument('# Plan\n\n## Goals\n\nText', { tabName: 'plan.md', profile }))
        expect(html).toContain('class="pdf-title-page"')
        expect(html).toContain('<a href="#goals"><span class="pdf-toc-title" dir="auto">Goals</span></a>')
    })

    it('puts the author and subtitle in the page details, escaped', async () => {
        const source = '---\nauthor: Ada & Co\nsubtitle: The "plan"\n---\n# Plan'
        const html = await renderExportHtml(buildExportDocument(source, { tabName: 'plan.md' }))
        expect(html).toContain('<meta name="author" content="Ada &amp; Co" />')
        expect(html).toContain('<meta name="description" content="The &quot;plan&quot;" />')
    })

    it('keeps a $ in the page details as typed', async () => {
        const source = "---\nauthor: $& Sons\nsubtitle: Save $$ and $' here\n---\n# Plan\n\nBody text"
        const html = await renderExportHtml(buildExportDocument(source, { tabName: 'plan.md' }))
        expect(html).toContain('<meta name="author" content="$&amp; Sons" />')
        expect(html).toContain(`<meta name="description" content="Save $$ and $' here" />`)
        expect(html.match(/Body text/g)).toHaveLength(1)
        expect(html.match(/<\/head>/g)).toHaveLength(1)
    })

    it('leaves the page details out when there is no author or subtitle', async () => {
        const html = await renderExportHtml(buildExportDocument('# Plan', { tabName: 'plan.md' }))
        expect(html).not.toContain('name="author"')
        expect(html).not.toContain('name="description"')
    })

    it('draws diagrams into the page', async () => {
        const html = await renderExportHtml(buildExportDocument('# Plan\n\n```mermaid\ngraph TD; A-->B\n```', { tabName: 'plan.md' }))
        expect(html).toContain('<svg data-mermaid="graph TD; A-->B"')
    })
})

describe('exportMarkdown as HTML', () => {
    beforeEach(() => {
        pickSavePath.mockReset()
        writeTextFileAtPath.mockClear()
        isTauri.mockReturnValue(true)
    })

    it('saves the page beside the document, as an .html file', async () => {
        pickSavePath.mockResolvedValue('D:\\docs\\plan.html')
        const result = await exportMarkdown('# Plan\n\nHello', 'plan.md', { format: 'html', documentPath: 'D:\\docs\\plan.md' })

        expect(pickSavePath).toHaveBeenCalledWith({
            title: 'Save HTML',
            defaultPath: 'D:\\docs\\plan.html',
            filters: [{ name: 'Web page', extensions: ['html', 'htm'] }],
        })
        const [path, html] = writeTextFileAtPath.mock.calls[0]!
        expect(path).toBe('D:\\docs\\plan.html')
        expect(html).toMatch(/^<!DOCTYPE html>/)
        expect(html).toContain('Hello')
        expect(result).toEqual({ status: 'saved', path: 'D:\\docs\\plan.html' })
    })

    it('saves nothing when the save picker is cancelled', async () => {
        pickSavePath.mockResolvedValue(null)
        await expect(exportMarkdown('# Plan', 'plan.md', { format: 'html' })).resolves.toEqual({ status: 'cancelled' })
        expect(writeTextFileAtPath).not.toHaveBeenCalled()
    })

    it('says why when the file cannot be written', async () => {
        pickSavePath.mockResolvedValue('D:\\locked\\plan.html')
        writeTextFileAtPath.mockRejectedValueOnce(new Error('Access is denied.'))
        await expect(exportMarkdown('# Plan', 'plan.md', { format: 'html' })).resolves.toEqual({ status: 'failed', message: 'Access is denied.' })
    })

    it('downloads the page outside the desktop app', async () => {
        isTauri.mockReturnValue(false)
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        URL.createObjectURL = vi.fn(() => 'blob:page')
        URL.revokeObjectURL = vi.fn()

        await expect(exportMarkdown('# Plan', 'plan.md', { format: 'html' })).resolves.toEqual({ status: 'saved' })
        const anchor = click.mock.contexts[0] as HTMLAnchorElement
        expect(anchor.download).toBe('plan.html')
        expect(pickSavePath).not.toHaveBeenCalled()
        click.mockRestore()
    })
})
