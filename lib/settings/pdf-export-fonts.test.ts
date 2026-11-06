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
        expect(options.find((option) => option.label === 'Comic Sans MS')?.value).toBe('"Comic Sans MS"')
        // Installed curated families show once, as the curated stack.
        expect(options.filter((option) => option.label === 'Arial')).toEqual([{ label: 'Arial', value: 'Arial, Helvetica, sans-serif' }])
        expect(options.filter((option) => option.label === 'Consolas')).toHaveLength(1)
    })

    it('leaves out system fonts a curated entry already covers, and repeats', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(['Palatino Linotype', 'Segoe UI', 'segoe ui', 'Calibri', 'calibri'])
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        expect(options).toHaveLength(PDF_EXPORT_FONT_OPTIONS.length + 1)
        expect(options.filter((option) => option.label.toLowerCase() === 'calibri')).toEqual([{ label: 'Calibri', value: '"Calibri"' }])
    })

    it('quotes system font names so ones like 0xProto stay valid CSS', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(['0xProto', 'A&B Sans', 'Odd "Quote" \\ Font'])
        const { loadPdfExportFontOptions } = await import('@/lib/settings/pdf-export-fonts')
        const values = (await loadPdfExportFontOptions()).map((option) => option.value)
        expect(values).toContain('"0xProto"')
        expect(values).toContain('"A&B Sans"')
        expect(values).toContain('"Odd \\"Quote\\" \\\\ Font"')
    })

    it('falls back to curated fonts when the Tauri command fails', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockRejectedValue(new Error('boom'))
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        await expect(loadPdfExportFontOptions()).resolves.toEqual([...PDF_EXPORT_FONT_OPTIONS].toSorted((a, b) => a.label.localeCompare(b.label)))
    })
})

describe('font stacks per picker', () => {
    it('gives a system font the generic family of its picker', async () => {
        const { fontOptionsForSlot, withGenericFallback } = await import('@/lib/settings/pdf-export-fonts')
        expect(withGenericFallback('"0xProto"', 'mono')).toBe('"0xProto", monospace')
        expect(withGenericFallback('"0xProto"', 'body')).toBe('"0xProto", sans-serif')
        // Stacks that already end in a generic family are left alone, a quoted "Serif" is just a name.
        expect(withGenericFallback('Georgia, "Times New Roman", serif', 'mono')).toBe('Georgia, "Times New Roman", serif')
        expect(withGenericFallback('"Serif"', 'heading')).toBe('"Serif", sans-serif')
        expect(withGenericFallback('', 'mono')).toBe('')

        const options = [
            { label: 'Fira Code', value: '"Fira Code"' },
            { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
        ]
        expect(fontOptionsForSlot(options, 'mono')).toEqual([
            { label: 'Fira Code', value: '"Fira Code", monospace' },
            { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
        ])
    })

    it('quotes names that are not valid CSS without quotes, and leaves valid stacks unchanged', async () => {
        const { repairFontStack, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        expect(repairFontStack('0xProto, sans-serif')).toBe('"0xProto", sans-serif')
        expect(repairFontStack('A&B Sans, Arial, sans-serif')).toBe('"A&B Sans", Arial, sans-serif')
        expect(repairFontStack('Calibri, sans-serif')).toBe('Calibri, sans-serif')
        expect(repairFontStack('"Comic Sans MS", sans-serif')).toBe('"Comic Sans MS", sans-serif')
        expect(repairFontStack('"a, b", serif')).toBe('"a, b", serif')
        for (const option of PDF_EXPORT_FONT_OPTIONS) expect(repairFontStack(option.value)).toBe(option.value)
    })

    it('matches a saved stack to its option by value, or by first family for older spellings', async () => {
        const { matchFontOption, ensureFontOption } = await import('@/lib/settings/pdf-export-fonts')
        const options = [
            { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
            { label: 'Calibri', value: '"Calibri", sans-serif' },
        ]
        expect(matchFontOption(options, 'Arial, Helvetica, sans-serif')?.label).toBe('Arial')
        expect(matchFontOption(options, 'Arial, sans-serif')?.label).toBe('Arial')
        expect(matchFontOption(options, 'calibri, sans-serif')?.label).toBe('Calibri')
        expect(matchFontOption(options, 'Gill Sans, sans-serif')).toBeUndefined()
        expect(ensureFontOption(options, 'Arial, sans-serif')).toBe(options)
    })
})
