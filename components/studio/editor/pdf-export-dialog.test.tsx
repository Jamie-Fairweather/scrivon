import nodeConsole from 'node:console'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { ExportFormat } from '@/lib/markdown/export-document'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import type { PdfPreview, PdfPreviewOptions } from '@/lib/markdown/export-pdf-preview'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { PdfExportDialog } from './pdf-export-dialog'
import { PREVIEW_DELAY_MS } from './pdf-export-preview'

const exportMarkdown = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>())
const notifyExportSaved = vi.hoisted(() => vi.fn())
const previewMarkdownPdf = vi.hoisted(() => vi.fn<(source: string, tabName: string | undefined, options: PdfPreviewOptions) => Promise<PdfPreview>>())
const notifyError = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ windows: true }))
/** Changes each export profile the dialog sees. */
const profiles = vi.hoisted((): { edit: (profile: PdfExportProfile) => void } => ({ edit: () => undefined }))

vi.mock('@/lib/markdown/export-pdf', () => ({ exportMarkdown, notifyExportSaved }))
vi.mock('@/lib/markdown/export-pdf-preview', () => ({ previewMarkdownPdf }))
vi.mock('@/lib/notify', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/notify')>()), notifyError }))
vi.mock('@/lib/tauri/platform', () => ({ isWindowsTauri: () => platform.windows }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => {
        const pdfExport = createDefaultPdfExportSettings()
        pdfExport.profiles.forEach((profile) => profiles.edit(profile))
        return { settings: { pdfExport } }
    },
}))

/** Stands in for the export menu, which owns the export state; `shown` mimics a tab switch unmounting the dialog. */
function Owner({
    shown = true,
    format,
    allowRemoteImages,
    onOpenChange,
}: {
    shown?: boolean
    format?: ExportFormat
    allowRemoteImages?: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [exporting, setExporting] = useState(false)
    if (!shown) return <p>{exporting ? 'Menu busy' : 'Menu idle'}</p>
    return (
        <PdfExportDialog
            open
            onOpenChange={onOpenChange}
            source={'# Report\n\nBody'}
            tabName="report.md"
            tabPath={'D:\\docs\\report.md'}
            workspaceRoot={'D:\\docs'}
            format={format}
            allowRemoteImages={allowRemoteImages}
            exporting={exporting}
            onExportingChange={setExporting}
        />
    )
}

function renderDialog() {
    const onOpenChange = vi.fn()
    const view = render(<Owner onOpenChange={onOpenChange} />)
    return { onOpenChange, view }
}

/** Lets the preview's wait after the last change run out. */
async function waitOutPreviewDelay() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS)
    })
}

function previewFrame(): HTMLIFrameElement {
    return screen.getByTitle('PDF preview') as HTMLIFrameElement
}

/** The preview's status line, which screen readers hear. */
function previewStatus(): HTMLElement {
    return within(screen.getByRole('region', { name: 'PDF preview' })).getByRole('status')
}

async function exportWithTitle(title: string) {
    const input = await screen.findByLabelText('Title')
    fireEvent.change(input, { target: { value: title } })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(exportMarkdown).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled())
}

describe('PdfExportDialog', () => {
    beforeEach(() => {
        exportMarkdown.mockReset()
        notifyExportSaved.mockReset()
        notifyError.mockReset()
        platform.windows = true
        profiles.edit = () => undefined
        previewMarkdownPdf.mockReset()
        previewMarkdownPdf.mockResolvedValue({ pdf: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) })
        let made = 0
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++made}`)
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('stays open with the edited fields when the save picker is cancelled', async () => {
        exportMarkdown.mockResolvedValue({ status: 'cancelled' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')

        expect(exportMarkdown).toHaveBeenCalledWith(
            '# Report\n\nBody',
            'report.md',
            expect.objectContaining({
                format: 'pdf',
                overrides: expect.objectContaining({ title: 'Quarterly report' }),
                // The save dialog starts in the document's folder, and its images are found from there.
                documentPath: 'D:\\docs\\report.md',
                workspaceRoot: 'D:\\docs',
            })
        )
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Title')).toHaveValue('Quarterly report')
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it("passes the preview's 'Load images' choice to the export", async () => {
        exportMarkdown.mockResolvedValue({ status: 'cancelled' })
        const blocked = render(<Owner onOpenChange={vi.fn()} />)
        await exportWithTitle('Report')
        expect(exportMarkdown).toHaveBeenLastCalledWith(expect.any(String), 'report.md', expect.objectContaining({ allowRemoteImages: false }))
        blocked.unmount()

        exportMarkdown.mockClear()
        render(<Owner allowRemoteImages onOpenChange={vi.fn()} />)
        await exportWithTitle('Report')
        expect(exportMarkdown).toHaveBeenLastCalledWith(expect.any(String), 'report.md', expect.objectContaining({ allowRemoteImages: true }))
    })

    it('shows a failure inside the dialog and clears it on the next try', async () => {
        exportMarkdown.mockResolvedValueOnce({ status: 'failed', message: 'Disk is full.' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')

        expect(onOpenChange).not.toHaveBeenCalled()
        expect(screen.getByRole('alert')).toHaveTextContent('Export failed: Disk is full.')
        expect(screen.getByLabelText('Title')).toHaveValue('Quarterly report')

        exportMarkdown.mockResolvedValueOnce({ status: 'cancelled' })
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    it('closes once the file is saved and says where', async () => {
        exportMarkdown.mockResolvedValue({ status: 'saved', path: 'C:/out/report.pdf' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(notifyExportSaved).toHaveBeenCalledWith({ status: 'saved', path: 'C:/out/report.pdf' })
    })

    it('passes why the page numbers were left out to the saved notice', async () => {
        const saved: ExportResult = {
            status: 'saved',
            path: 'C:/out/report.pdf',
            pageNumberWarning: "Scrivon couldn't add page numbers to this PDF.",
        }
        exportMarkdown.mockResolvedValue(saved)
        renderDialog()
        await exportWithTitle('Quarterly report')
        expect(notifyExportSaved).toHaveBeenCalledTimes(1)
        expect(notifyExportSaved).toHaveBeenCalledWith(saved)
    })

    it('passes any images the export left out to the saved notice', async () => {
        const missing = [{ slot: 'Cover image', path: 'G:/logo.png', reason: 'Could not read image: not found' }]
        exportMarkdown.mockResolvedValue({ status: 'saved', missingImages: missing })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(notifyExportSaved).toHaveBeenCalledWith({ status: 'saved', missingImages: missing })
    })

    it('shows progress and cannot be closed or edited while exporting', async () => {
        let finish: (result: ExportResult) => void = () => undefined
        exportMarkdown.mockReturnValue(new Promise<ExportResult>((resolve) => (finish = resolve)))
        const { onOpenChange } = renderDialog()
        const title = await screen.findByLabelText('Title')
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))

        await waitFor(() => expect(screen.getByText('Exporting…')).toBeInTheDocument())
        expect(title).toBeDisabled()
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onOpenChange).not.toHaveBeenCalled()

        finish({ status: 'cancelled' })
        await waitFor(() => expect(screen.queryByText('Exporting…')).toBeNull())
        expect(title).not.toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("shows 'Exporting…' before the export starts building, and clears it afterwards", async () => {
        let busyWhenStarted: boolean | undefined
        exportMarkdown.mockImplementation(async () => {
            // The build holds the main thread, so whatever is on screen now stays until it ends.
            busyWhenStarted = screen.queryByText('Exporting…') !== null
            return { status: 'cancelled' }
        })
        renderDialog()
        await screen.findByLabelText('Title')

        fireEvent.click(screen.getByRole('button', { name: 'Export' }))

        await waitFor(() => expect(exportMarkdown).toHaveBeenCalled())
        expect(busyWhenStarted).toBe(true)
        await waitFor(() => expect(screen.queryByText('Exporting…')).toBeNull())
    })

    it('keeps the export busy across a remount and closes the dialog once that export saves', async () => {
        let finish: (result: ExportResult) => void = () => undefined
        exportMarkdown.mockReturnValue(new Promise<ExportResult>((resolve) => (finish = resolve)))
        const { onOpenChange, view } = renderDialog()
        await screen.findByLabelText('Title')
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        await waitFor(() => expect(screen.getByText('Exporting…')).toBeInTheDocument())

        // A tab switch unmounts the dialog mid-export; the owner still knows an export is running.
        view.rerender(<Owner shown={false} onOpenChange={onOpenChange} />)
        expect(screen.getByText('Menu busy')).toBeInTheDocument()

        // The dialog comes back while the first export runs: it is locked, so no second export can start.
        view.rerender(<Owner onOpenChange={onOpenChange} />)
        const title = await screen.findByLabelText('Title')
        expect(screen.getByText('Exporting…')).toBeInTheDocument()
        expect(title).toBeDisabled()

        finish({ status: 'saved', path: 'C:/out/report.pdf' })
        await waitFor(() => expect(screen.queryByText('Exporting…')).toBeNull())
        expect(notifyExportSaved).toHaveBeenCalledWith({ status: 'saved', path: 'C:/out/report.pdf' })
        // The save finished, so the dialog closes, even though the form that started it is gone.
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(exportMarkdown).toHaveBeenCalledTimes(1)
    })

    it('reports a failure as a toast when the dialog went away mid-export', async () => {
        let finish: (result: ExportResult) => void = () => undefined
        exportMarkdown.mockReturnValue(new Promise<ExportResult>((resolve) => (finish = resolve)))
        const { onOpenChange, view } = renderDialog()
        await screen.findByLabelText('Title')
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        await waitFor(() => expect(screen.getByText('Exporting…')).toBeInTheDocument())

        view.rerender(<Owner shown={false} onOpenChange={onOpenChange} />)
        finish({ status: 'failed', message: 'Disk is full.' })
        await waitFor(() => expect(screen.getByText('Menu idle')).toBeInTheDocument())
        expect(notifyError).toHaveBeenCalledWith('Export failed', undefined, { description: 'Disk is full.' })
        expect(onOpenChange).not.toHaveBeenCalled()
    })

    it('passes a skipped contents page to the saved notice', async () => {
        const saved: ExportResult = { status: 'saved', path: 'C:/out/report.pdf', tocSkipped: true }
        exportMarkdown.mockResolvedValue(saved)
        renderDialog()
        await exportWithTitle('Quarterly report')
        expect(notifyExportSaved).toHaveBeenCalledWith(saved)
    })

    it('warns when the profile leaves no room on the page for the text', async () => {
        const bar = { enabled: true, heightMm: 60, gapMm: 60, ignoreMargins: true }
        profiles.edit = (profile) => {
            profile.page.orientation = 'landscape'
            profile.header = { ...profile.header, ...bar }
            profile.footer = { ...profile.footer, ...bar }
        }
        const cramped = render(<Owner onOpenChange={vi.fn()} />)
        expect(
            await screen.findByText('Margins, header and footer are taller than the page, so there is no room left for the text.')
        ).toBeInTheDocument()
        // Only a warning: the export can still run.
        expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled()
        cramped.unmount()

        profiles.edit = (profile) => {
            profile.page.orientation = 'landscape'
            // 210 mm tall: a 180 mm header band and the 10 mm bottom margin leave 20 mm.
            profile.header = { ...profile.header, ...bar, heightMm: 100, gapMm: 80 }
        }
        const tight = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText('Margins, header and footer leave only 20 mm of page height for the text.')).toBeInTheDocument()
        tight.unmount()

        profiles.edit = (profile) => {
            profile.page = {
                ...profile.page,
                size: 'custom',
                customSizeMm: { width: 100, height: 200 },
                marginsMm: { top: 10, right: 50, bottom: 10, left: 50 },
            }
        }
        const narrow = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText('The side margins are wider than the page, so there is no room left for the text.')).toBeInTheDocument()
        narrow.unmount()

        profiles.edit = () => undefined
        render(<Owner onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/Margins, header and footer|side margins/)).toBeNull()
    })

    it('says where subtitle, author and date go when the profile has no title page', async () => {
        const note = 'Subtitle, author and date appear on the title page (off in this profile) and in {{…}} header or footer text.'
        const view = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText(`${note} Author and subtitle are also saved in the file's properties.`)).toBeInTheDocument()
        view.unmount()

        // The print dialog outside Windows doesn't keep them in the PDF's properties; Word files do.
        platform.windows = false
        const printed = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText(note)).toBeInTheDocument()
        printed.unmount()
        const word = render(<Owner format="docx" onOpenChange={vi.fn()} />)
        expect(await screen.findByText(`${note} Author and subtitle are also saved in the file's properties.`)).toBeInTheDocument()
        word.unmount()

        profiles.edit = (profile) => {
            profile.frontMatter.titlePage = true
        }
        render(<Owner onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/appear on the title page/)).toBeNull()
    })

    it('says outside Windows that page numbers the profile asks for may be missing', async () => {
        platform.windows = false
        profiles.edit = (profile) => {
            profile.frontMatter.toc = true
            profile.footer.pageNumbers = 'n-of-total'
        }
        const view = render(<Owner onOpenChange={vi.fn()} />)
        expect(
            await screen.findByText('Outside the Windows app, footer page numbers may not print, and the table of contents shows no page numbers.')
        ).toBeInTheDocument()

        // Word files don't go through the print dialog.
        view.unmount()
        render(<Owner format="docx" onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/Outside the Windows app/)).toBeNull()
    })

    it('names only what the profile turns on, and says nothing on Windows or when nothing is lost', async () => {
        platform.windows = false
        profiles.edit = (profile) => {
            profile.frontMatter.toc = true
        }
        const toc = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText('Outside the Windows app, the table of contents shows no page numbers.')).toBeInTheDocument()
        toc.unmount()

        profiles.edit = (profile) => {
            profile.footer.pageNumbers = 'number'
        }
        const footer = render(<Owner onOpenChange={vi.fn()} />)
        expect(await screen.findByText('Outside the Windows app, footer page numbers may not print.')).toBeInTheDocument()
        footer.unmount()

        // A custom footer with no page placeholder prints as ordinary text.
        profiles.edit = (profile) => {
            profile.footer.pageNumbers = 'custom'
            profile.footer.right.text = 'Confidential'
        }
        const plain = render(<Owner onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/Outside the Windows app/)).toBeNull()
        plain.unmount()

        platform.windows = true
        profiles.edit = (profile) => {
            profile.frontMatter.toc = true
            profile.footer.pageNumbers = 'number'
        }
        render(<Owner onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/Outside the Windows app/)).toBeNull()
    })

    it('exports a web page when HTML is the format', async () => {
        exportMarkdown.mockResolvedValue({ status: 'saved', path: 'D:\\docs\\report.html' })
        const { onOpenChange } = renderDialogWith('html')
        expect(await screen.findByRole('combobox', { name: 'Format' })).toHaveTextContent('HTML')
        await exportWithTitle('Report')

        expect(exportMarkdown).toHaveBeenCalledWith('# Report\n\nBody', 'report.md', expect.objectContaining({ format: 'html' }))
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(notifyExportSaved).toHaveBeenCalledWith({ status: 'saved', path: 'D:\\docs\\report.html' })
    })

    it('leaves out the notes about pages for a web page, which has none', async () => {
        platform.windows = false
        const bar = { enabled: true, heightMm: 100, gapMm: 100, ignoreMargins: true }
        profiles.edit = (profile) => {
            profile.frontMatter.toc = true
            profile.footer = { ...profile.footer, ...bar, pageNumbers: 'number' }
        }
        renderDialogWith('html')
        expect(
            await screen.findByText(
                "Subtitle, author and date appear on the title page (off in this profile). Author and subtitle are also saved in the page's details."
            )
        ).toBeInTheDocument()
        expect(screen.queryByText(/Margins, header and footer/)).toBeNull()
        expect(screen.queryByText(/Outside the Windows app/)).toBeNull()
    })

    describe('PDF preview', () => {
        beforeEach(() => {
            vi.useFakeTimers({ shouldAdvanceTime: true })
            // happy-dom never loads frames, and logs that for each blob: PDF on Node's own console
            // (not the test's). Keep only that message out of the test output.
            const logError = nodeConsole.error.bind(nodeConsole)
            vi.spyOn(nodeConsole, 'error').mockImplementation((...args: unknown[]) => {
                const message = (args[0] as { message?: unknown } | undefined)?.message
                if (typeof message === 'string' && message.startsWith('Failed to load iframe page "blob:preview-')) return
                logError(...args)
            })
        })

        it('shows the PDF beside the settings and makes it again shortly after a change', async () => {
            renderDialog()
            expect(await screen.findByRole('region', { name: 'PDF preview' })).toBeInTheDocument()
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewFrame()).toHaveAttribute('src', 'blob:preview-1#navpanes=0'))
            const firstFrame = previewFrame()
            expect(previewMarkdownPdf).toHaveBeenCalledTimes(1)
            expect(previewMarkdownPdf).toHaveBeenCalledWith(
                '# Report\n\nBody',
                'report.md',
                expect.objectContaining({
                    profile: expect.objectContaining({ id: createDefaultPdfExportSettings().activeProfileId }),
                    overrides: expect.objectContaining({ title: 'Report' }),
                    // The preview finds the document's images as the export does.
                    documentPath: 'D:\\docs\\report.md',
                    workspaceRoot: 'D:\\docs',
                    allowRemoteImages: false,
                })
            )

            fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Quarterly' } })
            fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Quarterly report' } })
            expect(screen.getByText('Updating…')).toBeInTheDocument()
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewFrame()).toHaveAttribute('src', 'blob:preview-2#navpanes=0'))
            // Typing that stops within the wait makes one preview, not one per change.
            expect(previewMarkdownPdf).toHaveBeenCalledTimes(2)
            expect(previewMarkdownPdf).toHaveBeenLastCalledWith(
                expect.any(String),
                'report.md',
                expect.objectContaining({ overrides: expect.objectContaining({ title: 'Quarterly report' }) })
            )
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
            expect(screen.queryByText('Updating…')).toBeNull()
            // Each PDF gets a new frame, with no history for Back to return to the freed one.
            expect(previewFrame()).not.toBe(firstFrame)
        })

        it('makes it again when the profile settings change, but not when nothing did', async () => {
            const view = render(<Owner onOpenChange={vi.fn()} />)
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewFrame()).toHaveAttribute('src', 'blob:preview-1#navpanes=0'))

            // The settings are read afresh on every render; the same values don't count as a change.
            view.rerender(<Owner onOpenChange={vi.fn()} />)
            await waitOutPreviewDelay()
            expect(previewMarkdownPdf).toHaveBeenCalledTimes(1)

            profiles.edit = (profile) => {
                profile.page.marginsMm.top = 40
            }
            view.rerender(<Owner onOpenChange={vi.fn()} />)
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewMarkdownPdf).toHaveBeenCalledTimes(2))
            expect(previewMarkdownPdf.mock.calls[1][2].profile.page.marginsMm.top).toBe(40)
        })

        it('frees the PDF when the dialog closes', async () => {
            const { view } = renderDialog()
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewFrame()).toBeInTheDocument())
            view.unmount()
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
        })

        it('says what the preview left out, on the page and to screen readers', async () => {
            const note = 'There is no footer to put the page numbers in.'
            previewMarkdownPdf.mockResolvedValue({ pdf: new Blob(['%PDF-1.7']), note })
            renderDialog()
            expect(previewStatus()).toHaveTextContent('Updating…')
            await waitOutPreviewDelay()
            await waitFor(() => expect(previewStatus()).toHaveTextContent(note))
            const shown = screen.getAllByText(note).filter((element) => !element.closest('[role=status]'))
            expect(shown).toHaveLength(1)
        })

        it('says why the preview could not be made', async () => {
            previewMarkdownPdf.mockRejectedValue(new Error('Nothing to export.'))
            renderDialog()
            await waitOutPreviewDelay()
            expect(await screen.findByText('Preview failed: Nothing to export.')).toBeInTheDocument()
            expect(previewStatus()).toHaveTextContent('Preview failed.')
            expect(screen.queryByTitle('PDF preview')).toBeNull()
            // Only the export itself puts up an alert.
            expect(screen.queryByRole('alert')).toBeNull()
        })

        it('has no preview for Word files or web pages, or outside the Windows app', async () => {
            for (const format of ['docx', 'html'] as const) {
                const other = render(<Owner format={format} onOpenChange={vi.fn()} />)
                await screen.findByLabelText('Title')
                await waitOutPreviewDelay()
                expect(screen.queryByRole('region', { name: 'PDF preview' })).toBeNull()
                other.unmount()
            }

            platform.windows = false
            render(<Owner onOpenChange={vi.fn()} />)
            await screen.findByLabelText('Title')
            await waitOutPreviewDelay()
            expect(screen.queryByRole('region', { name: 'PDF preview' })).toBeNull()
            expect(previewMarkdownPdf).not.toHaveBeenCalled()
        })
    })
})

function renderDialogWith(format: ExportFormat) {
    const onOpenChange = vi.fn()
    const view = render(<Owner format={format} onOpenChange={onOpenChange} />)
    return { onOpenChange, view }
}
