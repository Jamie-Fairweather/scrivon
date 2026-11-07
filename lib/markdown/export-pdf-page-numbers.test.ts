import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const pickSavePath = vi.hoisted(() => vi.fn(async () => 'C:\\Users\\me\\Documents\\Report.pdf'))
const notify = vi.hoisted(() => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), notifyWarning: vi.fn() }))
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
vi.mock('@/lib/notify', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/notify')>()), ...notify }))
vi.mock('@/lib/markdown/export-assets', () => ({ resolvePdfExportAssets: vi.fn(async () => ({ assets: {}, missing: [] })) }))
vi.mock('@/lib/markdown/markdown-to-export-html', () => ({
    renderExportPdf: vi.fn(async () => ({ html: '<html></html>', print: PRINT })),
}))

import { exportMarkdown } from '@/lib/markdown/export-pdf'

const SAVED_TO = 'C:\\Users\\me\\Documents\\Report.pdf'

describe('saving a PDF whose page numbers could not be added', () => {
    beforeEach(() => {
        invoke.mockReset()
        Object.values(notify).forEach((fn) => fn.mockReset())
    })

    it('returns why the PDF was saved without page numbers, and shows nothing itself', async () => {
        invoke.mockResolvedValueOnce("Scrivon couldn't add page numbers to this PDF.")

        await expect(exportMarkdown('# Report', 'Report.md')).resolves.toEqual({
            status: 'saved',
            path: SAVED_TO,
            pageNumberWarning: "Scrivon couldn't add page numbers to this PDF.",
        })

        expect(invoke).toHaveBeenCalledWith('export_html_to_pdf', expect.objectContaining({ outputPath: SAVED_TO }))
        // The caller shows one notice for the whole export (notifyExportSaved).
        Object.values(notify).forEach((fn) => expect(fn).not.toHaveBeenCalled())
    })

    it('has no warning when the page numbers were added', async () => {
        invoke.mockResolvedValueOnce(null)

        await expect(exportMarkdown('# Report', 'Report.md')).resolves.toEqual({ status: 'saved', path: SAVED_TO })
    })
})
