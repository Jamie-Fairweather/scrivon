import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const pickSavePath = vi.hoisted(() => vi.fn(async () => 'C:\\Users\\me\\Documents\\Report.pdf'))
const notifySavedWithoutPageNumbers = vi.hoisted(() => vi.fn())
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

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/dialog', () => ({ pickSavePath, showError: vi.fn(), writeBinaryFile: vi.fn() }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true, isWindowsTauri: () => true }))
vi.mock('@/lib/markdown/export-assets', () => ({ resolvePdfExportAssets: vi.fn(async () => ({ assets: {}, missing: [] })) }))
vi.mock('@/lib/markdown/markdown-to-export-html', () => ({
    markdownToExportHtml: vi.fn(async () => ({ html: '<html></html>', print: PRINT })),
}))
vi.mock('@/lib/markdown/pdf-page-number-warning', () => ({ notifySavedWithoutPageNumbers }))

import { exportMarkdown } from '@/lib/markdown/export-pdf'

describe('saving a PDF whose page numbers could not be added', () => {
    beforeEach(() => {
        invoke.mockReset()
        notifySavedWithoutPageNumbers.mockReset()
    })

    it('says the PDF was saved without page numbers, and why', async () => {
        invoke.mockResolvedValueOnce('Could not open PDF to number pages: invalid file header')

        await exportMarkdown('# Report', 'Report.md')

        expect(invoke).toHaveBeenCalledWith('export_html_to_pdf', expect.objectContaining({ outputPath: 'C:\\Users\\me\\Documents\\Report.pdf' }))
        expect(notifySavedWithoutPageNumbers).toHaveBeenCalledWith('Could not open PDF to number pages: invalid file header')
    })

    it('says nothing extra when the page numbers were added', async () => {
        invoke.mockResolvedValueOnce(null)

        await exportMarkdown('# Report', 'Report.md')

        expect(invoke).toHaveBeenCalledWith('export_html_to_pdf', expect.anything())
        expect(notifySavedWithoutPageNumbers).not.toHaveBeenCalled()
    })
})
