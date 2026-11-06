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

/** Which picker a font is for. It decides the generic family that fills in glyphs the font lacks. */
export type PdfExportFontSlot = 'heading' | 'body' | 'mono'

const SLOT_GENERIC: Record<PdfExportFontSlot, string> = { heading: 'sans-serif', body: 'sans-serif', mono: 'monospace' }

const GENERIC_FAMILIES = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong',
])

const QUOTED_FAMILY = /^(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/
const CSS_IDENTIFIER = /^(?:--|-?[_a-zA-Z\u0080-￿])[-_a-zA-Z0-9\u0080-￿]*$/

/** Splits a CSS font-family list on the commas outside quoted names. */
function splitFontStack(stack: string): string[] {
    const parts: string[] = []
    let current = ''
    let quote: string | null = null
    for (let index = 0; index < stack.length; index++) {
        const char = stack[index]!
        current += char
        if (quote) {
            if (char === '\\' && index + 1 < stack.length) current += stack[++index]
            else if (char === quote) quote = null
        } else if (char === '"' || char === "'") {
            quote = char
        } else if (char === ',') {
            parts.push(current.slice(0, -1).trim())
            current = ''
        }
    }
    parts.push(current.trim())
    return parts.filter(Boolean)
}

/** One family, unquoted and lower-cased, so different spellings of the same name compare equal. */
function familyKey(part: string): string {
    const quoted = QUOTED_FAMILY.exec(part)
    const name = quoted ? quoted[2]!.replace(/\\([\s\S])/g, '$1') : part.replace(/\s+/g, ' ')
    return name.trim().toLowerCase()
}

function firstFamilyKey(stack: string): string {
    return familyKey(splitFontStack(stack)[0] ?? '')
}

/** Valid as written: a quoted string, or names the browser accepts without quotes. */
function isValidFamily(part: string): boolean {
    return QUOTED_FAMILY.test(part) || part.split(/\s+/).every((word) => CSS_IDENTIFIER.test(word))
}

/** A family name as a CSS string, so names like `0xProto` or `A&B` stay valid. */
function quoteFontFamily(family: string): string {
    return `"${family.replace(/[\\"]/g, '\\$&')}"`
}

/**
 * Quotes any family that isn't valid CSS without quotes, such as `0xProto`. One bad name
 * makes the browser drop the whole font-family, so the text falls back to the default font.
 * A stack that is already valid comes back unchanged.
 */
export function repairFontStack(stack: string): string {
    const parts = splitFontStack(stack)
    if (parts.every(isValidFamily)) return stack
    return parts.map((part) => (isValidFamily(part) ? part : quoteFontFamily(part.replace(/\s+/g, ' ')))).join(', ')
}

/** `stack` with the slot's generic family added when it has none, so missing glyphs come from a similar font. */
export function withGenericFallback(stack: string, slot: PdfExportFontSlot): string {
    const parts = splitFontStack(stack)
    if (parts.length === 0 || parts.some((part) => GENERIC_FAMILIES.has(part.toLowerCase()))) return stack
    return [...parts, SLOT_GENERIC[slot]].join(', ')
}

async function listSystemFontFamilies(): Promise<string[]> {
    if (!isTauri()) return []
    try {
        return await invoke<string[]>('list_system_fonts')
    } catch {
        return []
    }
}

/**
 * Curated stacks plus the OS fonts via Tauri (no browser permission prompt). A system font
 * whose name a curated entry already covers is left out. System entries are just the quoted
 * name; `fontOptionsForSlot` adds the right generic fallback for each picker.
 */
export async function loadPdfExportFontOptions(): Promise<PdfExportFontOption[]> {
    const taken = new Set(PDF_EXPORT_FONT_OPTIONS.flatMap((option) => [familyKey(option.label), firstFamilyKey(option.value)]))
    const options = [...PDF_EXPORT_FONT_OPTIONS]

    for (const family of await listSystemFontFamilies()) {
        const trimmed = family.trim()
        const key = familyKey(trimmed)
        if (!key || taken.has(key)) continue
        taken.add(key)
        options.push({ label: trimmed, value: quoteFontFamily(trimmed) })
    }

    return options.toSorted((a, b) => a.label.localeCompare(b.label))
}

/** The options one picker offers: any stack without a generic family gets the slot's one. */
export function fontOptionsForSlot(options: PdfExportFontOption[], slot: PdfExportFontSlot): PdfExportFontOption[] {
    return options.map((option) => ({ ...option, value: withGenericFallback(option.value, slot) }))
}

/**
 * The option a saved stack selects: the same value, or else the same first family, so a
 * value saved by an older build (such as `Arial, sans-serif`) still shows as Arial.
 */
export function matchFontOption(options: PdfExportFontOption[], value: string): PdfExportFontOption | undefined {
    const key = firstFamilyKey(value)
    return options.find((option) => option.value === value) ?? (key ? options.find((option) => firstFamilyKey(option.value) === key) : undefined)
}

export function ensureFontOption(options: PdfExportFontOption[], value: string): PdfExportFontOption[] {
    if (!value.trim() || matchFontOption(options, value)) return options
    return [{ label: 'Current', value }, ...options]
}
