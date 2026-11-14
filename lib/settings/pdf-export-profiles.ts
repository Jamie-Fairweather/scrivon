import { pdfBodyWidthMm } from '@/lib/markdown/export-html-css'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportProfile, PdfExportSettings } from '@/lib/settings/pdf-export-types'

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

/** Profile names are compared trimmed and ignoring case: "Report" and " report" look the same in a picker. */
function profileNameKey(name: string): string {
    return name.trim().toLowerCase()
}

/**
 * `base`, or `base 2`, `base 3`… — the first one no profile already uses
 * (names compared trimmed and case-insensitively), so pickers can tell profiles apart.
 */
export function uniqueProfileName(profiles: readonly Pick<PdfExportProfile, 'name'>[], base: string): string {
    const taken = new Set(profiles.map((profile) => profileNameKey(profile.name)))
    const name = base.trim()
    if (!taken.has(name.toLowerCase())) return name
    for (let n = 2; ; n++) {
        const candidate = `${name} ${n}`
        if (!taken.has(candidate.toLowerCase())) return candidate
    }
}

/**
 * Another profile with the same name as `name` (compared as uniqueProfileName does), if any.
 * Renaming can still produce a twin, so the settings can point it out.
 */
export function otherProfileNamed<T extends Pick<PdfExportProfile, 'id' | 'name'>>(
    profiles: readonly T[],
    profileId: string,
    name: string
): T | undefined {
    const key = profileNameKey(name)
    return key ? profiles.find((profile) => profile.id !== profileId && profileNameKey(profile.name) === key) : undefined
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

/** The name a profile from a file is added under: its own, unless another profile has it. */
export function importedProfileName(profiles: readonly Pick<PdfExportProfile, 'name'>[], name: string): string {
    return uniqueProfileName(profiles, name.trim() || 'Imported profile')
}

/** Adds a profile from a file under a new id, renamed when another profile has its name, and picks it. */
export function importPdfExportProfile(settings: PdfExportSettings, imported: PdfExportProfile): PdfExportSettings {
    const profile = cloneProfile(imported, newProfileId(), importedProfileName(settings.profiles, imported.name))
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

/** Below this much page width for the text, the settings warn that the side margins leave too little. */
export const PDF_MIN_BODY_WIDTH_MM = 40

/**
 * The warning for side margins that leave little or no page width for the text, or '' when there is room.
 * Only a narrow custom page can get here: the named sizes are too wide for the biggest margins.
 */
export function pdfPageWidthWarning(profile: PdfExportProfile): string {
    const widthMm = pdfBodyWidthMm(profile)
    if (widthMm >= PDF_MIN_BODY_WIDTH_MM) return ''
    if (widthMm <= 0) return 'The side margins are wider than the page, so there is no room left for the text.'
    return `The side margins leave only ${Math.floor(widthMm)} mm of page width for the text.`
}

// One copy, shared with the export, so the warning and the export agree on how much room is left.
export { PDF_AUTO_BAR_HEIGHT_MM, pdfBodyHeightMm, pdfBodyWidthMm } from '@/lib/markdown/export-html-css'
