import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import { PdfExportDialog } from './pdf-export-dialog'

const exportMarkdown = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>())
const notifyExportSaved = vi.hoisted(() => vi.fn())

vi.mock('@/lib/markdown/export-pdf', () => ({ exportMarkdown, notifyExportSaved }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { pdfExport: createDefaultPdfExportSettings() } }),
}))

// happy-dom has no Web Animations API; the dialog's scroll area asks for running animations.
if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []

function renderDialog() {
    const onOpenChange = vi.fn()
    render(<PdfExportDialog open onOpenChange={onOpenChange} source={'# Report\n\nBody'} tabName="report.md" />)
    return { onOpenChange }
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
    })

    it('stays open with the edited fields when the save picker is cancelled', async () => {
        exportMarkdown.mockResolvedValue({ status: 'cancelled' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')

        expect(exportMarkdown).toHaveBeenCalledWith(
            '# Report\n\nBody',
            'report.md',
            expect.objectContaining({ format: 'pdf', overrides: expect.objectContaining({ title: 'Quarterly report' }) })
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
        expect(notifyExportSaved).toHaveBeenCalledWith('C:/out/report.pdf')
    })

    it('says nothing extra when the print dialog or a download took over', async () => {
        exportMarkdown.mockResolvedValue({ status: 'saved' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(notifyExportSaved).not.toHaveBeenCalled()
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
})
