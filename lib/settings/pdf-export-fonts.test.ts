import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => false))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

describe('pdf export fonts', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(false)
    })

    it('ensures the current value appears in the option list', async () => {
        const { PDF_EXPORT_FONT_OPTIONS, ensureFontOption } = await import('@/lib/settings/pdf-export-fonts')
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, PDF_EXPORT_FONT_OPTIONS[0]!.value)).toEqual(PDF_EXPORT_FONT_OPTIONS)
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, 'CustomFont, sans-serif')[0]).toEqual({
            label: 'Current',
            value: 'CustomFont, sans-serif',
        })
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, '   ')).toEqual(PDF_EXPORT_FONT_OPTIONS)
    })

    it('returns curated fonts when not running in Tauri', async () => {
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        expect(invoke).not.toHaveBeenCalled()
        expect(options).toEqual([...PDF_EXPORT_FONT_OPTIONS].toSorted((a, b) => a.label.localeCompare(b.label)))
    })

    it('merges Tauri system font families without using the browser API', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(['Comic Sans MS', 'Arial', '', '  Consolas  '])
        const { loadPdfExportFontOptions } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        expect(invoke).toHaveBeenCalledWith('list_system_fonts')
        expect(options.some((option) => option.label === 'Comic Sans MS')).toBe(true)
        expect(options.some((option) => option.value === 'Arial, sans-serif')).toBe(true)
        expect(options.some((option) => option.label === 'Consolas')).toBe(true)
    })

    it('falls back to curated fonts when the Tauri command fails', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockRejectedValue(new Error('boom'))
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        await expect(loadPdfExportFontOptions()).resolves.toEqual([...PDF_EXPORT_FONT_OPTIONS].toSorted((a, b) => a.label.localeCompare(b.label)))
    })
})
