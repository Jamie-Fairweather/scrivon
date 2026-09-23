import { SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'
import type { PdfExportProfile, PdfExportSettings } from '@/lib/settings/pdf-export-types'

export const DEFAULT_PDF_EXPORT_PROFILE_ID = 'default'

export const DEFAULT_PDF_BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const DEFAULT_PDF_MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/** Numeric ranges the settings UI offers and the normaliser clamps to; one source so they cannot drift. */
export const PDF_EXPORT_LIMITS = {
    marginMm: { min: 0, max: 50, step: 1 },
    bodySizePt: { min: 8, max: 24, step: 0.5 },
    lineHeight: { min: 1, max: 2.5, step: 0.1 },
    /** Header/footer bar height and gap. */
    chromeMm: { min: 0, max: 60, step: 1 },
} as const

export function createDefaultPdfExportProfile(overrides: Partial<Pick<PdfExportProfile, 'id' | 'name'>> = {}): PdfExportProfile {
    return {
        id: overrides.id ?? DEFAULT_PDF_EXPORT_PROFILE_ID,
        name: overrides.name ?? 'Default',
        page: {
            size: 'a4',
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
