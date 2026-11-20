import { describe, expect, it, vi } from 'vitest'
import { batchExportAvailability, buildBatchExportCommands, EXPORT_FOLDER_DIAGRAMS_ID } from './batch-export-commands'

describe('batchExportAvailability', () => {
    it('is on in the desktop app with a folder open and no export running', () => {
        expect(batchExportAvailability({ isDesktop: true, hasFolder: true, exporting: false })).toEqual({ disabled: false, reason: '' })
    })

    it('says why it is off', () => {
        expect(batchExportAvailability({ isDesktop: false, hasFolder: true, exporting: false })).toEqual({ disabled: true, reason: 'Desktop only' })
        expect(batchExportAvailability({ isDesktop: true, hasFolder: false, exporting: false })).toEqual({ disabled: true, reason: 'No folder open' })
        expect(batchExportAvailability({ isDesktop: true, hasFolder: true, exporting: true })).toEqual({ disabled: true, reason: 'Exporting…' })
    })
})

describe('buildBatchExportCommands', () => {
    it('offers Export All Diagrams in Folder… for the palette and the File menu', () => {
        const exportOpenFolder = vi.fn()
        const [command, ...more] = buildBatchExportCommands({ availability: { disabled: false, reason: '' }, exportOpenFolder })

        expect(more).toEqual([])
        expect(command).toMatchObject({ id: EXPORT_FOLDER_DIAGRAMS_ID, label: 'Export All Diagrams in Folder…', disabled: false })
        expect(command!.keywords).toContain('batch')
        void command!.run()
        expect(exportOpenFolder).toHaveBeenCalled()
    })

    it('is greyed out with its reason', () => {
        const [command] = buildBatchExportCommands({ availability: { disabled: true, reason: 'No folder open' }, exportOpenFolder: vi.fn() })

        expect(command).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
    })
})
