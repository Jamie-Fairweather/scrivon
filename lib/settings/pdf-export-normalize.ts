import { isAppThemeId } from '@/lib/theme/catalog'
import { createDefaultPdfExportProfile, createDefaultPdfExportSettings } from '@/lib/settings/pdf-export-defaults'
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
export const MAX_CHROME_HEIGHT_MM = 60

function normalizeTocDepth(value: unknown, fallback: PdfTocDepth): PdfTocDepth {
    if (value === 1 || value === 2 || value === 3 || value === 4) return value
    if (value === '1' || value === '2' || value === '3' || value === '4') return Number(value) as PdfTocDepth
    return fallback
}

function normalizeNewPageFromHeading(flow: Record<string, unknown> | null, fallback: PdfNewPageFromHeading): PdfNewPageFromHeading {
    const raw = flow?.newPageFromHeading
    if (raw === 0 || raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6) return raw
    if (raw === '0' || raw === '1' || raw === '2' || raw === '3' || raw === '4' || raw === '5' || raw === '6') {
        return Number(raw) as PdfNewPageFromHeading
    }
    // Migrate legacy boolean
    if (typeof flow?.h1StartsNewPage === 'boolean') return flow.h1StartsNewPage ? 1 : 0
    return fallback
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

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return fallback
    return Math.min(max, Math.max(min, value))
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function normalizeMargins(raw: unknown, fallback: PdfExportProfile['page']['marginsMm']): PdfExportProfile['page']['marginsMm'] {
    const source = asRecord(raw)
    return {
        top: normalizeNumber(source?.top, fallback.top, 0, 50),
        right: normalizeNumber(source?.right, fallback.right, 0, 50),
        bottom: normalizeNumber(source?.bottom, fallback.bottom, 0, 50),
        left: normalizeNumber(source?.left, fallback.left, 0, 50),
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
        heightMm: normalizeNumber(source?.heightMm, fallback.heightMm, 0, MAX_CHROME_HEIGHT_MM),
        gapMm: normalizeNumber(source?.gapMm, fallback.gapMm, 0, MAX_CHROME_HEIGHT_MM),
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
            bodySizePt: normalizeNumber(typography?.bodySizePt, fallback.typography.bodySizePt, 8, 24),
            lineHeight: normalizeNumber(typography?.lineHeight, fallback.typography.lineHeight, 1, 2.5),
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
            tocDepth: normalizeTocDepth(frontMatter?.tocDepth, fallback.frontMatter.tocDepth),
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
