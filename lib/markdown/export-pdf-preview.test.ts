import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { ExportDocument } from '@/lib/markdown/export-document'
import { previewMarkdownPdf } from './export-pdf-preview'

const invoke = vi.hoisted(() => vi.fn())
const PRINT = vi.hoisted(() => ({
    pageWidthMm: 210,
    pageHeightMm: 297,
    landscape: false,
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 10,
    marginLeftMm: 10,
    pageNumberFormat: 'page-n',
    pageNumberColor: '',
}))
type RenderExportPdf = (
    document: ExportDocument,
    options?: { stamped?: boolean; allowRemoteImages?: boolean }
) => Promise<{ html: string; metadata: ExportDocument['metadata']; print: typeof PRINT }>
const renderExportPdf = vi.hoisted(() =>
    vi.fn<RenderExportPdf>(async (document) => ({
        html: `<html>${document.metadata.title}</html>`,
        metadata: document.metadata,
        print: PRINT,
    }))
)
const LOGO = vi.hoisted(() => ({ logoDataUrl: 'data:image/png;base64,AAAA', header: { left: '', right: '' }, footer: { left: '', right: '' } }))
const resolvePdfExportAssets = vi.hoisted(() => vi.fn(async () => ({ assets: LOGO, missing: [] })))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/markdown/markdown-to-export-html', () => ({ renderExportPdf }))
vi.mock('@/lib/markdown/export-assets', () => ({ resolvePdfExportAssets }))

describe('previewMarkdownPdf', () => {
    beforeEach(() => {
        invoke.mockReset()
        renderExportPdf.mockClear()
        resolvePdfExportAssets.mockClear()
    })

    it('prints the export with page numbers stamped, through the same steps as a real export', async () => {
        // '%PDF-1.7' in base64.
        invoke.mockResolvedValue({ pdf: 'JVBERi0xLjc=', pageNumberWarning: null })
        const profile = createDefaultPdfExportProfile()

        const preview = await previewMarkdownPdf('# Report\n\nBody', 'report.md', {
            profile,
            overrides: { title: 'Quarterly report' },
            allowRemoteImages: true,
        })

        expect(resolvePdfExportAssets).toHaveBeenCalledWith(profile)
        const [document, options] = renderExportPdf.mock.calls[0]
        expect(document.metadata.title).toBe('Quarterly report')
        expect(document.assets.logoDataUrl).toBe(LOGO.logoDataUrl)
        expect(options).toEqual({ stamped: true, allowRemoteImages: true })
        expect(invoke).toHaveBeenCalledWith('preview_html_pdf', { html: '<html>Quarterly report</html>', options: PRINT })

        expect(preview.pdf.type).toBe('application/pdf')
        expect(new TextDecoder().decode(await preview.pdf.arrayBuffer())).toBe('%PDF-1.7')
        expect(preview.pageNumberWarning).toBeUndefined()
    })

    it('passes on why the page numbers were left out', async () => {
        invoke.mockResolvedValue({ pdf: '', pageNumberWarning: 'There is no footer to put the page numbers in.' })
        const preview = await previewMarkdownPdf('Body', undefined, { profile: createDefaultPdfExportProfile() })
        expect(preview.pageNumberWarning).toBe('There is no footer to put the page numbers in.')
        expect(renderExportPdf.mock.calls[0][1]).toEqual({ stamped: true, allowRemoteImages: false })
    })

    it('fails with the reason when the document or the print fails', async () => {
        await expect(previewMarkdownPdf('   ', 'empty.md', { profile: createDefaultPdfExportProfile() })).rejects.toThrow('Nothing to export.')
        expect(invoke).not.toHaveBeenCalled()

        invoke.mockRejectedValue('Creating the PDF took too long, so it was stopped. Try again.')
        await expect(previewMarkdownPdf('Body', 'report.md', { profile: createDefaultPdfExportProfile() })).rejects.toBe(
            'Creating the PDF took too long, so it was stopped. Try again.'
        )
    })
})
