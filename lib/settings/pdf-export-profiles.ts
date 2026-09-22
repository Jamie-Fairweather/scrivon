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

export function getActivePdfExportProfile(settings: PdfExportSettings): PdfExportProfile {
    return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]!
}

export function setActivePdfExportProfile(settings: PdfExportSettings, profileId: string): PdfExportSettings {
    if (!settings.profiles.some((profile) => profile.id === profileId)) return settings
    return { ...settings, activeProfileId: profileId }
}

export function createPdfExportProfile(settings: PdfExportSettings, name = 'New profile'): PdfExportSettings {
    const profile = createDefaultPdfExportProfile({ id: newProfileId(), name })
    return {
        profiles: [...settings.profiles, profile],
        activeProfileId: profile.id,
    }
}

export function duplicatePdfExportProfile(settings: PdfExportSettings, profileId: string): PdfExportSettings {
    const source = settings.profiles.find((profile) => profile.id === profileId)
    if (!source) return settings
    const profile = cloneProfile(source, newProfileId(), `${source.name} copy`)
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
