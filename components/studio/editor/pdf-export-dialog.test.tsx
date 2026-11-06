import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
import type { ExportResult } from '@/lib/markdown/export-pdf'
import { PdfExportDialog } from './pdf-export-dialog'

const exportMarkdown = vi.hoisted(() => vi.fn<() => Promise<ExportResult>>())

vi.mock('@/lib/markdown/export-pdf', () => ({ exportMarkdown }))
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

    it('closes once the file is saved', async () => {
        exportMarkdown.mockResolvedValue({ status: 'saved', path: 'C:/out/report.pdf' })
        const { onOpenChange } = renderDialog()
        await exportWithTitle('Quarterly report')
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })
})
