import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { ExportFormat } from '@/lib/markdown/export-document'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { PdfExportDialog } from './pdf-export-dialog'

const exportMarkdown = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>())
const notifyExportSaved = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ windows: true }))
/** Changes each export profile the dialog sees. */
const profiles = vi.hoisted((): { edit: (profile: PdfExportProfile) => void } => ({ edit: () => undefined }))

vi.mock('@/lib/markdown/export-pdf', () => ({ exportMarkdown, notifyExportSaved }))
vi.mock('@/lib/notify', () => ({ notifyError }))
vi.mock('@/lib/tauri/platform', () => ({ isWindowsTauri: () => platform.windows }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => {
        const pdfExport = createDefaultPdfExportSettings()
        pdfExport.profiles.forEach((profile) => profiles.edit(profile))
        return { settings: { pdfExport } }
    },
}))

// happy-dom has no Web Animations API; the dialog's scroll area asks for running animations.
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []

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
                // The save dialog starts in the document's folder.
                documentPath: 'D:\\docs\\report.md',
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
        const missing = [{ slot: 'Logo', path: 'G:/logo.png', reason: 'Could not read image: not found' }]
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

        profiles.edit = () => undefined
        render(<Owner onOpenChange={vi.fn()} />)
        await screen.findByLabelText('Title')
        expect(screen.queryByText(/Margins, header and footer/)).toBeNull()
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
})
