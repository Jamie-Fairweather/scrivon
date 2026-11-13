import { isMacPlatform } from '@/lib/settings/chord-utils'
import { mergeStoredSettings } from '@/lib/settings/migrate'
import { settingsToStore } from '@/lib/settings/storage'
import type { AppSettings } from '@/lib/settings/types'

/** What `scrivon` says in a file of all settings, and in a file of one export profile. */
export const SETTINGS_FILE_KIND = 'settings'
export const PROFILE_FILE_KIND = 'export-profile'
/** The layout of exported files. A higher number means a newer Scrivon wrote it. */
export const TRANSFER_FILE_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The parsed file, or undefined when it isn't JSON. */
export function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}

/** The text of a file holding all settings and export profiles, as Export settings saves it. */
export function settingsExportText(settings: AppSettings): string {
    const file = { scrivon: SETTINGS_FILE_KIND, version: TRANSFER_FILE_VERSION, settings: settingsToStore(settings) }
    return JSON.stringify(file, null, 2)
}

/** The settings saved in a file, or null when it holds something else. */
function savedSettingsIn(file: unknown): unknown {
    if (!isRecord(file)) return null
    if (file.scrivon === SETTINGS_FILE_KIND) return file.settings
    if (file.scrivon === PROFILE_FILE_KIND) throw new Error('This is an export profile. Import it in Settings, Document export.')
    // The copy in settings.json is the settings on their own, as saved.
    return typeof file.schemaVersion === 'number' ? file : null
}

/**
 * The settings in an exported settings file, or in the copy Scrivon keeps in its data folder (settings.json).
 * Values out of range are put back in range, as when settings load. Throws an Error saying why for any
 * other file.
 */
export function readSettingsExport(text: string): AppSettings {
    const saved = savedSettingsIn(parseJson(text))
    if (!isRecord(saved)) throw new Error("This file isn't a Scrivon settings file.")
    return mergeStoredSettings(saved, isMacPlatform())
}
