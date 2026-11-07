import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => false))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

/** What list_system_fonts returns: each family, and whether its letters all take the same width. */
const systemFonts = (...families: string[]) => families.map((family) => ({ family, monospace: false }))

describe('pdf export fonts', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(false)
    })

    it('ensures the current value appears in the option list, named after its font', async () => {
        const { PDF_EXPORT_FONT_OPTIONS, ensureFontOption } = await import('@/lib/settings/pdf-export-fonts')
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, PDF_EXPORT_FONT_OPTIONS[0]!.value)).toEqual(PDF_EXPORT_FONT_OPTIONS)
        // Without a system font list nothing says the font is missing.
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, '"Custom Font", sans-serif')[0]).toEqual({
            label: 'Custom Font',
            value: '"Custom Font", sans-serif',
            saved: true,
        })
        expect(ensureFontOption(PDF_EXPORT_FONT_OPTIONS, '   ')).toEqual(PDF_EXPORT_FONT_OPTIONS)

        const withSystem = [...PDF_EXPORT_FONT_OPTIONS, { label: 'Calibri', value: '"Calibri"', system: true }]
        expect(ensureFontOption(withSystem, 'CustomFont, sans-serif')[0]).toEqual({
            label: 'CustomFont (not installed)',
            value: 'CustomFont, sans-serif',
            saved: true,
        })
        expect(ensureFontOption(withSystem, 'monospace')[0]).toEqual({ label: 'monospace', value: 'monospace', saved: true })
    })

    it('groups common stacks before installed fonts and spots icon fonts', async () => {
        const { groupFontOptions, isSymbolFont } = await import('@/lib/settings/pdf-export-fonts')
        const arial = { label: 'Arial', value: 'Arial, Helvetica, sans-serif' }
        const calibri = { label: 'Calibri', value: '"Calibri"', system: true }
        expect(groupFontOptions([calibri, arial])).toEqual([
            { value: 'Common fonts', items: [arial] },
            { value: 'Installed fonts', items: [calibri] },
        ])
        expect(groupFontOptions([arial])).toEqual([{ value: 'Common fonts', items: [arial] }])

        expect(['Wingdings 2', 'Webdings', 'Segoe MDL2 Assets', 'Symbol'].every(isSymbolFont)).toBe(true)
        expect(['Segoe UI Symbol', 'Arial', 'Symbola'].some(isSymbolFont)).toBe(false)
    })

    it('returns curated fonts when not running in Tauri', async () => {
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        expect(invoke).not.toHaveBeenCalled()
        expect(options).toEqual([...PDF_EXPORT_FONT_OPTIONS].toSorted((a, b) => a.label.localeCompare(b.label)))
    })

    it('merges Tauri system font families without using the browser API', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(systemFonts('Comic Sans MS', 'Arial', '', '  Consolas  '))
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
        invoke.mockResolvedValue(systemFonts('Palatino Linotype', 'Segoe UI', 'segoe ui', 'Calibri', 'calibri'))
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        expect(options).toHaveLength(PDF_EXPORT_FONT_OPTIONS.length + 1)
        expect(options.filter((option) => option.label.toLowerCase() === 'calibri')).toEqual([{ label: 'Calibri', value: '"Calibri"', system: true }])
    })

    it('quotes system font names so ones like 0xProto stay valid CSS', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(systemFonts('0xProto', 'A&B Sans', 'Odd "Quote" \\ Font'))
        const { loadPdfExportFontOptions } = await import('@/lib/settings/pdf-export-fonts')
        const values = (await loadPdfExportFontOptions()).map((option) => option.value)
        expect(values).toContain('"0xProto"')
        expect(values).toContain('"A&B Sans"')
        expect(values).toContain('"Odd \\"Quote\\" \\\\ Font"')
    })

    it('loads the system fonts once and shares the list', async () => {
        vi.resetModules()
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue(systemFonts('Calibri'))
        const { cachedPdfExportFontOptions, loadPdfExportFontOptionsOnce } = await import('@/lib/settings/pdf-export-fonts')
        expect(cachedPdfExportFontOptions()).toBeNull()

        const [first, second] = await Promise.all([loadPdfExportFontOptionsOnce(), loadPdfExportFontOptionsOnce()])
        expect(second).toBe(first)
        expect(await loadPdfExportFontOptionsOnce()).toBe(first)
        expect(cachedPdfExportFontOptions()).toBe(first)
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('tries again next time when no system fonts came back', async () => {
        vi.resetModules()
        isTauri.mockReturnValue(true)
        invoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(systemFonts('Calibri'))
        const { cachedPdfExportFontOptions, loadPdfExportFontOptionsOnce } = await import('@/lib/settings/pdf-export-fonts')
        expect((await loadPdfExportFontOptionsOnce()).some((option) => option.system)).toBe(false)
        expect(cachedPdfExportFontOptions()).toBeNull()

        expect((await loadPdfExportFontOptionsOnce()).map((option) => option.label)).toContain('Calibri')
        expect(invoke).toHaveBeenCalledTimes(2)
    })

    it('falls back to curated fonts when the Tauri command fails', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockRejectedValue(new Error('boom'))
        const { loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        await expect(loadPdfExportFontOptions()).resolves.toEqual([...PDF_EXPORT_FONT_OPTIONS].toSorted((a, b) => a.label.localeCompare(b.label)))
    })
})

describe('font stacks per picker', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(false)
    })

    it('gives a system font the generic family of its picker', async () => {
        const { fontOptionsForSlot, withGenericFallback } = await import('@/lib/settings/pdf-export-fonts')
        expect(withGenericFallback('"0xProto"', 'mono')).toBe('"0xProto", monospace')
        expect(withGenericFallback('"0xProto"', 'body')).toBe('"0xProto", sans-serif')
        // Stacks that already end in a generic family are left alone, a quoted "Serif" is just a name.
        expect(withGenericFallback('Georgia, "Times New Roman", serif', 'mono')).toBe('Georgia, "Times New Roman", serif')
        expect(withGenericFallback('"Serif"', 'heading')).toBe('"Serif", sans-serif')
        expect(withGenericFallback('', 'mono')).toBe('')

        const options = [
            { label: 'Fira Code', value: '"Fira Code"', system: true, monospace: true },
            { label: 'Consolas', value: 'Consolas, "Courier New", monospace', monospace: true },
        ]
        expect(fontOptionsForSlot(options, 'mono')).toEqual([
            { label: 'Fira Code', value: '"Fira Code", monospace', system: true, monospace: true },
            { label: 'Consolas', value: 'Consolas, "Courier New", monospace', monospace: true },
        ])
    })

    it('offers only monospaced fonts in the Monospace picker, and every font in the others', async () => {
        isTauri.mockReturnValue(true)
        invoke.mockResolvedValue([
            { family: 'Fira Code', monospace: true },
            { family: 'Calibri', monospace: false },
            { family: 'Arial', monospace: false },
        ])
        const { fontOptionsForSlot, loadPdfExportFontOptions } = await import('@/lib/settings/pdf-export-fonts')
        const options = await loadPdfExportFontOptions()
        const labels = (slot: 'mono' | 'body') => fontOptionsForSlot(options, slot).map((option) => option.label)
        expect(labels('mono')).toEqual(['Consolas', 'Courier New', 'Fira Code', 'Monaco', 'UI Monospace'])
        expect(labels('body')).toEqual(expect.arrayContaining(['Arial', 'Calibri', 'Consolas', 'Fira Code']))
    })

    it('still shows a saved font the Monospace picker leaves out, in its own group', async () => {
        const { ensureFontOption, fontOptionsForSlot, groupFontOptions, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        const installed = [...PDF_EXPORT_FONT_OPTIONS, { label: 'Calibri', value: '"Calibri"', system: true }]
        const mono = fontOptionsForSlot(installed, 'mono')

        // Saved by a build whose Monospace picker listed every font: installed, so not "(not installed)".
        const items = ensureFontOption(mono, 'Arial, Helvetica, sans-serif', installed)
        expect(items[0]).toEqual({ label: 'Arial', value: 'Arial, Helvetica, sans-serif', saved: true })
        expect(groupFontOptions(items).map((group) => [group.value, group.items.map((option) => option.label)])).toEqual([
            ['Saved font', ['Arial']],
            ['Common fonts', ['Courier New', 'Consolas', 'Monaco', 'UI Monospace']],
        ])
        expect(ensureFontOption(mono, '"Fira Code", monospace', installed)[0]!.label).toBe('Fira Code (not installed)')
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

    it('swaps the sans-serif fallback older builds gave Monospace picks for monospace', async () => {
        const { repairMonoFontStack, PDF_EXPORT_FONT_OPTIONS } = await import('@/lib/settings/pdf-export-fonts')
        expect(repairMonoFontStack('"Cascadia Code", sans-serif')).toBe('"Cascadia Code", monospace')
        expect(repairMonoFontStack('0xProto, SANS-SERIF')).toBe('"0xProto", monospace')
        expect(repairMonoFontStack('"Odd \\"Quote\\" Font", sans-serif')).toBe('"Odd \\"Quote\\" Font", monospace')
        // Not the old shape: a generic family first, a lone name, or a longer stack.
        expect(repairMonoFontStack('system-ui, sans-serif')).toBe('system-ui, sans-serif')
        expect(repairMonoFontStack('"Fira Code"')).toBe('"Fira Code"')
        expect(repairMonoFontStack('Menlo, Monaco, sans-serif')).toBe('Menlo, Monaco, sans-serif')
        for (const option of PDF_EXPORT_FONT_OPTIONS) expect(repairMonoFontStack(option.value)).toBe(option.value)
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
