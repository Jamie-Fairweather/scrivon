import { isMacPlatform } from '@/lib/settings/chord-utils'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { mergeStoredSettings } from '@/lib/settings/migrate'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { changeImages, embedImages, isEmbedded, type LeftOutImage } from '@/lib/settings/profile-images'
import { isRecord, settingsToStore } from '@/lib/settings/storage'
import { readExportImage, saveProfileImage } from '@/lib/tauri/export-image-access'
import type { AppSettings } from '@/lib/settings/types'

/** What `scrivon` says in a file of all settings, and in a file of one export profile. */
export const SETTINGS_FILE_KIND = 'settings'
export const PROFILE_FILE_KIND = 'export-profile'
/**
 * The layout of exported files. Raise it only when an older Scrivon couldn't read the new layout:
 * older ones then ask to be updated instead of misreading the file.
 */
export const TRANSFER_FILE_VERSION = 1

/** Throws an Error saying to update Scrivon when a newer one wrote the file. */
export function checkFileVersion(file: Record<string, unknown>): void {
    if (typeof file.version === 'number' && file.version > TRANSFER_FILE_VERSION) {
        throw new Error('This file is from a newer Scrivon. Update Scrivon, then import it again.')
    }
}

/** The parsed file, or undefined when it isn't JSON. */
export function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}

/** `settings` with each profile changed by `change`. What was left out names the profile too. */
async function changeEachProfile(
    settings: AppSettings,
    change: (profile: PdfExportProfile) => Promise<{ profile: PdfExportProfile; leftOut: LeftOutImage[] }>
): Promise<{ settings: AppSettings; leftOut: LeftOutImage[] }> {
    const profiles: PdfExportProfile[] = []
    const leftOut: LeftOutImage[] = []
    for (const profile of settings.pdfExport.profiles) {
        const changed = await change(profile)
        profiles.push(changed.profile)
        leftOut.push(...changed.leftOut.map(({ slot, reason }) => ({ slot: `${slot} in "${profile.name}"`, reason })))
    }
    return { settings: { ...settings, pdfExport: { ...settings.pdfExport, profiles } }, leftOut }
}

/**
 * The text of a file holding all settings and export profiles, as Export settings saves it. Profile images
 * are embedded, so it works on another computer. An image that can't be read is left out and listed.
 */
export async function settingsExportText(settings: AppSettings): Promise<{ text: string; leftOut: LeftOutImage[] }> {
    const embedded = await changeEachProfile(settings, embedImages)
    const file = { scrivon: SETTINGS_FILE_KIND, version: TRANSFER_FILE_VERSION, settings: settingsToStore(embedded.settings) }
    return { text: JSON.stringify(file, null, 2), leftOut: embedded.leftOut }
}

/** The settings saved in a file, or null when it holds something else. */
function savedSettingsIn(file: unknown): unknown {
    if (!isRecord(file)) return null
    if (file.scrivon === SETTINGS_FILE_KIND) {
        checkFileVersion(file)
        return file.settings
    }
    if (file.scrivon === PROFILE_FILE_KIND) throw new Error('This is an export profile. Import it in Settings, Document export.')
    // The copy in settings.json is the settings on their own, as saved. Settings last saved before 1.5.0
    // have no schemaVersion, so a group of settings Scrivon knows (theme, editor…) will do too.
    return typeof file.schemaVersion === 'number' || hasSettingsGroup(file) ? file : null
}

function hasSettingsGroup(file: Record<string, unknown>): boolean {
    return Object.keys(createDefaultSettings(false)).some((key) => isRecord(file[key]))
}

/**
 * The settings in an exported settings file, or in the copy Scrivon keeps in its data folder (settings.json).
 * Values out of range are put back in range, as when settings load. Throws an Error saying why for any
 * other file.
 */
export async function readSettingsExport(text: string): Promise<{ settings: AppSettings; leftOut: LeftOutImage[] }> {
    const saved = savedSettingsIn(parseJson(text))
    if (!isRecord(saved)) throw new Error("This file isn't a Scrivon settings file.")
    return changeEachProfile(mergeStoredSettings(saved, isMacPlatform()), (profile) => changeImages(profile, importImage))
}

/**
 * An image from a settings file, as this computer uses it. An embedded one is saved in Scrivon's data folder.
 * A path (from a file exported before images were embedded) is kept only when the export can already read it.
 */
async function importImage(image: string): Promise<string> {
    if (isEmbedded(image)) return saveProfileImage(image)
    await readExportImage(image)
    return image
}
