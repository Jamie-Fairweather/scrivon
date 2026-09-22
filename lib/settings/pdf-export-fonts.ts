import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

export type PdfExportFontOption = {
    label: string
    value: string
}

/** Curated stacks that work without querying the OS font list. */
export const PDF_EXPORT_FONT_OPTIONS: PdfExportFontOption[] = [
    {
        label: 'System UI',
        value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    { label: 'Segoe UI', value: '"Segoe UI", Tahoma, sans-serif' },
    { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
    { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
    { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
    { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
    { label: 'Garamond', value: 'Garamond, "Times New Roman", serif' },
    { label: 'Courier New', value: '"Courier New", Courier, monospace' },
    { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
    { label: 'Monaco', value: 'Monaco, Consolas, monospace' },
    {
        label: 'UI Monospace',
        value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
]

function familyToCssValue(family: string): string {
    return family.includes(' ') ? `"${family}", sans-serif` : `${family}, sans-serif`
}

async function listSystemFontFamilies(): Promise<string[]> {
    if (!isTauri()) return []
    try {
        return await invoke<string[]>('list_system_fonts')
    } catch {
        return []
    }
}

/** Merge curated options with OS fonts via Tauri (no browser permission prompt). */
export async function loadPdfExportFontOptions(): Promise<PdfExportFontOption[]> {
    const byValue = new Map(PDF_EXPORT_FONT_OPTIONS.map((option) => [option.value, option]))
    const families = await listSystemFontFamilies()

    for (const family of families) {
        const trimmed = family.trim()
        if (!trimmed) continue
        const value = familyToCssValue(trimmed)
        byValue.set(value, { label: trimmed, value })
    }

    return [...byValue.values()].toSorted((a, b) => a.label.localeCompare(b.label))
}

export function ensureFontOption(options: PdfExportFontOption[], value: string): PdfExportFontOption[] {
    if (!value.trim() || options.some((option) => option.value === value)) return options
    return [{ label: 'Current', value }, ...options]
}
