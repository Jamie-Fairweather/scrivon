import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import { PdfExportDialog } from './pdf-export-dialog'

const exportMarkdown = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>())
const notifyExportSaved = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/markdown/export-pdf', () => ({ exportMarkdown, notifyExportSaved }))
vi.mock('@/lib/notify', () => ({ notifyError }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { pdfExport: createDefaultPdfExportSettings() } }),
}))

// happy-dom has no Web Animations API; the dialog's scroll area asks for running animations.
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []

/** Stands in for the export menu, which owns the export state; `shown` mimics a tab switch unmounting the dialog. */
function Owner({ shown = true, onOpenChange }: { shown?: boolean; onOpenChange: (open: boolean) => void }) {
    const [exporting, setExporting] = useState(false)
    if (!shown) return <p>{exporting ? 'Menu busy' : 'Menu idle'}</p>
    return (
        <PdfExportDialog
            open
            onOpenChange={onOpenChange}
            source={'# Report\n\nBody'}
            tabName="report.md"
            tabPath={'D:\\docs\\report.md'}
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
        expect(notifyExportSaved).toHaveBeenCalledWith('C:/out/report.pdf', undefined)
    })

    it('passes any images the export left out to the saved notice', async () => {
        const missing = [{ slot: 'Logo', path: 'G:/logo.png', reason: 'Could not read image: not found' }]
        exportMarkdown.mockResolvedValue({ status: 'saved', missingImages: missing })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(notifyExportSaved).toHaveBeenCalledWith(undefined, missing)
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
        expect(notifyExportSaved).toHaveBeenCalledWith('C:/out/report.pdf', undefined)
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
})
