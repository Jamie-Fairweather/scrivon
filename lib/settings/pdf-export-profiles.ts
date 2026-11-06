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
    if (profiles.length === settings.profiles.length) return settings
    const activeProfileId = settings.activeProfileId === profileId ? profiles[0]!.id : settings.activeProfileId
    return { profiles, activeProfileId }
}
