import { SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'
import type { PdfExportProfile, PdfExportSettings, PdfPageSize } from '@/lib/settings/pdf-export-types'

export const DEFAULT_PDF_EXPORT_PROFILE_ID = 'default'

export const DEFAULT_PDF_BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const DEFAULT_PDF_MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/**
 * Numeric ranges the settings UI offers and the normaliser clamps to; one source so they cannot drift.
 * `precision` is how many decimals a typed value keeps (1.15 line height, 12.7 mm half-inch margin)
 * while the arrows still move by `step`.
 */
export const PDF_EXPORT_LIMITS = {
    marginMm: { min: 0, max: 50, step: 1, precision: 1 },
    bodySizePt: { min: 8, max: 24, step: 0.5 },
    lineHeight: { min: 1, max: 2.5, step: 0.1, precision: 2 },
    /** Header/footer bar height and gap. */
    chromeMm: { min: 0, max: 60, step: 1, precision: 1 },
    /** Custom page width and height. Word pages can't be bigger than 22 inches. */
    pageMm: { min: 100, max: 550, step: 1, precision: 1 },
} as const

/** The named paper sizes, upright, with the name CSS `@page` knows them by. */
export const PDF_PAGE_SIZES: Record<Exclude<PdfPageSize, 'custom'>, { label: string; css: string; widthMm: number; heightMm: number }> = {
    a3: { label: 'A3 (297 × 420 mm)', css: 'A3', widthMm: 297, heightMm: 420 },
    a4: { label: 'A4 (210 × 297 mm)', css: 'A4', widthMm: 210, heightMm: 297 },
    a5: { label: 'A5 (148 × 210 mm)', css: 'A5', widthMm: 148, heightMm: 210 },
    letter: { label: 'Letter (8.5 × 11 in)', css: 'letter', widthMm: 215.9, heightMm: 279.4 },
    legal: { label: 'Legal (8.5 × 14 in)', css: 'legal', widthMm: 215.9, heightMm: 355.6 },
}

export function createDefaultPdfExportProfile(overrides: Partial<Pick<PdfExportProfile, 'id' | 'name'>> = {}): PdfExportProfile {
    return {
        id: overrides.id ?? DEFAULT_PDF_EXPORT_PROFILE_ID,
        name: overrides.name ?? 'Default',
        page: {
            size: 'a4',
            customSizeMm: { width: 210, height: 297 },
            orientation: 'portrait',
            marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
        },
        typography: {
            headingFont: DEFAULT_PDF_BODY_FONT,
            bodyFont: DEFAULT_PDF_BODY_FONT,
            monoFont: DEFAULT_PDF_MONO_FONT,
            bodySizePt: 11,
            lineHeight: 1.6,
            justify: false,
        },
        brand: {
            accentColor: '#262626',
            linkColor: '',
            logoPath: '',
            logoIgnoreMargins: false,
        },
        frontMatter: {
            titlePage: false,
            toc: false,
            tocDepth: 3,
            tocExcludeH1: true,
            tocTitle: 'Contents',
        },
        header: {
            enabled: false,
            left: { text: '', imagePath: '' },
            right: { text: '', imagePath: '' },
            backgroundColor: '',
            textColor: '',
            heightMm: 0,
            gapMm: 0,
            ignoreMargins: false,
            hideOnFirstPages: 'title',
        },
        footer: {
            enabled: false,
            left: { text: '', imagePath: '' },
            right: { text: '', imagePath: '' },
            backgroundColor: '',
            textColor: '',
            heightMm: 0,
            gapMm: 0,
            ignoreMargins: false,
            hideOnFirstPages: 'title',
            pageNumbers: 'none',
            numberFromBody: false,
        },
        flow: {
            newPageFromHeading: 0,
        },
        content: {
            codeTheme: 'github-light',
            mermaidThemeId: SYSTEM_LIGHT_THEME,
            watermark: '',
        },
    }
}

export function createDefaultPdfExportSettings(): PdfExportSettings {
    const profile = createDefaultPdfExportProfile()
    return {
        profiles: [profile],
        activeProfileId: profile.id,
    }
}
