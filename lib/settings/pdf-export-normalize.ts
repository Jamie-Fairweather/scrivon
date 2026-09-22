import { isAppThemeId } from '@/lib/theme/catalog'
import { createDefaultPdfExportProfile, createDefaultPdfExportSettings, PDF_EXPORT_LIMITS } from '@/lib/settings/pdf-export-defaults'
import type {
    PdfExportChrome,
    PdfExportChromeSide,
    PdfExportFooter,
    PdfExportProfile,
    PdfExportSettings,
    PdfHideOnFirstPages,
    PdfPageNumberFormat,
    PdfNewPageFromHeading,
    PdfPageOrientation,
    PdfPageSize,
    PdfTocDepth,
} from '@/lib/settings/pdf-export-types'
import type { ShikiTheme } from '@/lib/markdown/shiki-highlighter'

const PAGE_SIZES: PdfPageSize[] = ['a4', 'letter']
const ORIENTATIONS: PdfPageOrientation[] = ['portrait', 'landscape']
const HIDE_OPTIONS: PdfHideOnFirstPages[] = ['none', 'title', 'title+toc']
const PAGE_NUMBER_FORMATS: PdfPageNumberFormat[] = ['none', 'number', 'page-n', 'n-of-total', 'custom']
const CODE_THEMES: ShikiTheme[] = ['github-light', 'github-dark']
const TOC_DEPTHS: PdfTocDepth[] = [1, 2, 3, 4]
const NEW_PAGE_LEVELS: PdfNewPageFromHeading[] = [0, 1, 2, 3, 4, 5, 6]

/** Small integer enums; accepts the number or its string form (older builds stored select values as strings). */
function normalizeIntEnum<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
    const num = typeof value === 'string' ? Number(value) : value
    return (allowed as readonly number[]).includes(num as number) ? (num as T) : fallback
}

function normalizeNewPageFromHeading(flow: Record<string, unknown> | null, fallback: PdfNewPageFromHeading): PdfNewPageFromHeading {
    // Profiles from before the level picker stored a boolean; it only applies when no valid level is present.
    const legacy = typeof flow?.h1StartsNewPage === 'boolean' ? ((flow.h1StartsNewPage ? 1 : 0) as PdfNewPageFromHeading) : fallback
    return normalizeIntEnum(flow?.newPageFromHeading, NEW_PAGE_LEVELS, legacy)
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null
    return value as Record<string, unknown>
}

function normalizeString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function normalizeNumber(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return fallback
    return Math.min(max, Math.max(min, value))
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function normalizeMargins(raw: unknown, fallback: PdfExportProfile['page']['marginsMm']): PdfExportProfile['page']['marginsMm'] {
    const source = asRecord(raw)
    const limits = PDF_EXPORT_LIMITS.marginMm
    return {
        top: normalizeNumber(source?.top, fallback.top, limits),
        right: normalizeNumber(source?.right, fallback.right, limits),
        bottom: normalizeNumber(source?.bottom, fallback.bottom, limits),
        left: normalizeNumber(source?.left, fallback.left, limits),
    }
}

function normalizeSide(raw: unknown, fallback: PdfExportChromeSide): PdfExportChromeSide {
    const source = asRecord(raw)
    return {
        text: normalizeString(source?.text, fallback.text),
        imagePath: normalizeString(source?.imagePath, fallback.imagePath),
    }
}

function normalizeChrome(raw: unknown, fallback: PdfExportChrome): PdfExportChrome {
    const source = asRecord(raw)
    // Profiles saved before the bars had two ends kept a single text/image; those were drawn on the left.
    const legacyLeft: PdfExportChromeSide = {
        text: normalizeString(source?.text, fallback.left.text),
        imagePath: normalizeString(source?.imagePath, fallback.left.imagePath),
    }
    return {
        enabled: typeof source?.enabled === 'boolean' ? source.enabled : fallback.enabled,
        left: normalizeSide(source?.left, legacyLeft),
        right: normalizeSide(source?.right, fallback.right),
        backgroundColor: normalizeString(source?.backgroundColor, fallback.backgroundColor),
        textColor: normalizeString(source?.textColor, fallback.textColor),
        heightMm: normalizeNumber(source?.heightMm, fallback.heightMm, PDF_EXPORT_LIMITS.chromeMm),
        gapMm: normalizeNumber(source?.gapMm, fallback.gapMm, PDF_EXPORT_LIMITS.chromeMm),
        ignoreMargins: normalizeBoolean(source?.ignoreMargins, fallback.ignoreMargins),
        hideOnFirstPages: normalizeEnum(source?.hideOnFirstPages, HIDE_OPTIONS, fallback.hideOnFirstPages),
    }
}

function normalizeFooter(raw: unknown, fallback: PdfExportFooter): PdfExportFooter {
    const chrome = normalizeChrome(raw, fallback)
    const source = asRecord(raw)
    return {
        ...chrome,
        pageNumbers: normalizeEnum(source?.pageNumbers, PAGE_NUMBER_FORMATS, fallback.pageNumbers),
    }
}

export function normalizePdfExportProfile(raw: unknown, fallback: PdfExportProfile = createDefaultPdfExportProfile()): PdfExportProfile {
    const source = asRecord(raw)
    if (!source) return structuredClone(fallback)

    const page = asRecord(source.page)
    const typography = asRecord(source.typography)
    const brand = asRecord(source.brand)
    const frontMatter = asRecord(source.frontMatter)
    const flow = asRecord(source.flow)
    const content = asRecord(source.content)

    const mermaidThemeId =
        typeof content?.mermaidThemeId === 'string' && isAppThemeId(content.mermaidThemeId) ? content.mermaidThemeId : fallback.content.mermaidThemeId

    return {
        id: normalizeString(source.id, fallback.id) || fallback.id,
        name: normalizeString(source.name, fallback.name) || fallback.name,
        page: {
            size: normalizeEnum(page?.size, PAGE_SIZES, fallback.page.size),
            orientation: normalizeEnum(page?.orientation, ORIENTATIONS, fallback.page.orientation),
            marginsMm: normalizeMargins(page?.marginsMm, fallback.page.marginsMm),
        },
        typography: {
            headingFont: normalizeString(typography?.headingFont, fallback.typography.headingFont),
            bodyFont: normalizeString(typography?.bodyFont, fallback.typography.bodyFont),
            monoFont: normalizeString(typography?.monoFont, fallback.typography.monoFont),
            bodySizePt: normalizeNumber(typography?.bodySizePt, fallback.typography.bodySizePt, PDF_EXPORT_LIMITS.bodySizePt),
            lineHeight: normalizeNumber(typography?.lineHeight, fallback.typography.lineHeight, PDF_EXPORT_LIMITS.lineHeight),
        },
        brand: {
            accentColor: normalizeString(brand?.accentColor, fallback.brand.accentColor),
            linkColor: normalizeString(brand?.linkColor, fallback.brand.linkColor),
            logoPath: normalizeString(brand?.logoPath, fallback.brand.logoPath),
            logoIgnoreMargins: normalizeBoolean(brand?.logoIgnoreMargins, fallback.brand.logoIgnoreMargins),
        },
        frontMatter: {
            titlePage: typeof frontMatter?.titlePage === 'boolean' ? frontMatter.titlePage : fallback.frontMatter.titlePage,
            toc: typeof frontMatter?.toc === 'boolean' ? frontMatter.toc : fallback.frontMatter.toc,
            tocDepth: normalizeIntEnum(frontMatter?.tocDepth, TOC_DEPTHS, fallback.frontMatter.tocDepth),
            tocExcludeH1: typeof frontMatter?.tocExcludeH1 === 'boolean' ? frontMatter.tocExcludeH1 : fallback.frontMatter.tocExcludeH1,
        },
        header: normalizeChrome(source.header, fallback.header),
        footer: normalizeFooter(source.footer, fallback.footer),
        flow: {
            newPageFromHeading: normalizeNewPageFromHeading(flow, fallback.flow.newPageFromHeading),
        },
        content: {
            codeTheme: normalizeEnum(content?.codeTheme, CODE_THEMES, fallback.content.codeTheme),
            mermaidThemeId,
            watermark: normalizeString(content?.watermark, fallback.content.watermark),
        },
    }
}

export function normalizePdfExportSettings(raw: unknown): PdfExportSettings {
    const defaults = createDefaultPdfExportSettings()
    const source = asRecord(raw)
    if (!source) return defaults

    const profilesRaw = Array.isArray(source.profiles) ? source.profiles : null
    const profiles =
        profilesRaw && profilesRaw.length > 0
            ? profilesRaw.map((profile, index) =>
                  normalizePdfExportProfile(profile, createDefaultPdfExportProfile({ id: `profile-${index}`, name: `Profile ${index + 1}` }))
              )
            : defaults.profiles

    const ids = new Set(profiles.map((profile) => profile.id))
    const activeProfileId = typeof source.activeProfileId === 'string' && ids.has(source.activeProfileId) ? source.activeProfileId : profiles[0]!.id

    return { profiles, activeProfileId }
}
