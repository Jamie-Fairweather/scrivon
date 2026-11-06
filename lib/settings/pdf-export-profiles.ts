import { pdfPageSizeMm, resolvePdfExportLayout } from '@/lib/markdown/export-html-css'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportChrome, PdfExportProfile, PdfExportSettings } from '@/lib/settings/pdf-export-types'

function newProfileId(): string {
    return crypto.randomUUID()
}

function cloneProfile(profile: PdfExportProfile, id: string, name: string): PdfExportProfile {
    return {
        ...structuredClone(profile),
        id,
        name,
    }
}

/**
 * `base`, or `base 2`, `base 3`… — the first one no profile already uses
 * (names compared trimmed and case-insensitively), so pickers can tell profiles apart.
 */
export function uniqueProfileName(profiles: readonly Pick<PdfExportProfile, 'name'>[], base: string): string {
    const taken = new Set(profiles.map((profile) => profile.name.trim().toLowerCase()))
    const name = base.trim()
    if (!taken.has(name.toLowerCase())) return name
    for (let n = 2; ; n++) {
        const candidate = `${name} ${n}`
        if (!taken.has(candidate.toLowerCase())) return candidate
    }
}

/** "Report" → "Report copy"; a copy of "Report copy" or "Report copy 2" is also "Report copy", then made unique. */
function copyName(profiles: readonly PdfExportProfile[], sourceName: string): string {
    const original = sourceName.trim().replace(/ copy(?: \d+)?$/i, '')
    return uniqueProfileName(profiles, `${original} copy`)
}

export function getActivePdfExportProfile(settings: PdfExportSettings): PdfExportProfile {
    return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]!
}

export function setActivePdfExportProfile(settings: PdfExportSettings, profileId: string): PdfExportSettings {
    if (!settings.profiles.some((profile) => profile.id === profileId)) return settings
    return { ...settings, activeProfileId: profileId }
}

export function createPdfExportProfile(settings: PdfExportSettings, name = 'New profile'): PdfExportSettings {
    const profile = createDefaultPdfExportProfile({ id: newProfileId(), name: uniqueProfileName(settings.profiles, name) })
    return {
        profiles: [...settings.profiles, profile],
        activeProfileId: profile.id,
    }
}

export function duplicatePdfExportProfile(settings: PdfExportSettings, profileId: string): PdfExportSettings {
    const source = settings.profiles.find((profile) => profile.id === profileId)
    if (!source) return settings
    const profile = cloneProfile(source, newProfileId(), copyName(settings.profiles, source.name))
    return {
        profiles: [...settings.profiles, profile],
        activeProfileId: profile.id,
    }
}

export function renamePdfExportProfile(settings: PdfExportSettings, profileId: string, name: string): PdfExportSettings {
    const trimmed = name.trim()
    if (!trimmed) return settings
    return {
        ...settings,
        profiles: settings.profiles.map((profile) => (profile.id === profileId ? { ...profile, name: trimmed } : profile)),
    }
}

export function updatePdfExportProfile(
    settings: PdfExportSettings,
    profileId: string,
    updater: (profile: PdfExportProfile) => PdfExportProfile
): PdfExportSettings {
    return {
        ...settings,
        profiles: settings.profiles.map((profile) => (profile.id === profileId ? updater(profile) : profile)),
    }
}

export function deletePdfExportProfile(settings: PdfExportSettings, profileId: string): PdfExportSettings {
    if (settings.profiles.length <= 1) return settings
    const profiles = settings.profiles.filter((profile) => profile.id !== profileId)
    // Unchanged when nothing matched, or when every profile matched (repeated ids): one must stay.
    if (profiles.length === settings.profiles.length || profiles.length === 0) return settings
    const activeProfileId = settings.activeProfileId === profileId ? profiles[0]!.id : settings.activeProfileId
    return { profiles, activeProfileId }
}

/** Below this much page height for the text, the settings warn that the page is nearly full. */
export const PDF_MIN_BODY_HEIGHT_MM = 40

/**
 * Rough height of a header or footer bar left at "0 fits the content". The PDF export sizes
 * body images with the same estimate (AUTO_BAR_HEIGHT_MM in lib/markdown/export-html-css.ts),
 * so the warning and the export agree on how much room is left.
 */
export const PDF_AUTO_BAR_HEIGHT_MM = 12

/**
 * Page height left for the document text once the top and bottom margins and any shown
 * header/footer (its height, or PDF_AUTO_BAR_HEIGHT_MM when it fits its content, plus its
 * gap) are taken off. A bar that ignores margins sits inside the margin band, so it only
 * takes more room once it is taller than the margin.
 * With the Footer switch off, page numbers still print, but on their own: the export drops
 * the footer's height, gap and edge-to-edge band (applyPdfFooterSwitch), so only a bare
 * content-sized row counts.
 * Negative when they add up to more than the page.
 */
export function pdfBodyHeightMm(profile: PdfExportProfile): number {
    const sheet = pdfPageSizeMm(profile)
    const pageHeight = profile.page.orientation === 'landscape' ? sheet.width : sheet.height
    const footer = profile.footer.enabled ? profile.footer : { ...profile.footer, heightMm: 0, gapMm: 0, ignoreMargins: false }
    const layout = resolvePdfExportLayout({ ...profile, footer })
    const band = (margin: number, bar: PdfExportChrome, shown: boolean, bleeds: boolean) => {
        if (!shown) return margin
        const barMm = (bar.heightMm > 0 ? bar.heightMm : PDF_AUTO_BAR_HEIGHT_MM) + bar.gapMm
        return bleeds ? Math.max(margin, barMm) : margin + barMm
    }
    const { top, bottom } = profile.page.marginsMm
    return (
        pageHeight - band(top, profile.header, layout.showHeader, layout.headerBleeds) - band(bottom, footer, layout.showFooter, layout.footerBleeds)
    )
}
