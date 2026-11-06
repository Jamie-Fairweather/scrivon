import { isMacPlatform } from '@/lib/settings/chord-utils'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import {
    dualWriteLegacyAutosave,
    dualWriteLegacyLayout,
    dualWriteLegacyTheme,
    keybindOverrides,
    mergeStoredSettings,
    migrateLegacySettings,
} from '@/lib/settings/migrate'
import type { AppSettings } from '@/lib/settings/types'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

/** The last settings that loaded cleanly, kept so unreadable settings can be restored. */
export const SETTINGS_BACKUP_KEY = `${SETTINGS_STORAGE_KEY}.bak`
/** Unreadable settings are copied to this prefix plus a timestamp before anything replaces them. */
export const SETTINGS_CORRUPT_KEY_PREFIX = `${SETTINGS_STORAGE_KEY}.corrupt-`

/** How settings were recovered when the saved copy couldn't be read: from the backup, or reset. */
export type SettingsRecovery = 'backup' | 'reset' | null

export type LoadedSettings = {
    settings: AppSettings
    recovery: SettingsRecovery
}

function readItem(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function writeItem(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {
        // private browsing / quota
    }
}

/** Settings read from saved text, or null when the text is missing or isn't a settings object. */
function readStored(raw: string | null, isMac: boolean): AppSettings | null {
    if (raw === null) return null
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        return mergeStoredSettings(parsed, isMac)
    } catch {
        return null
    }
}

/**
 * Loads settings and says whether they had to be recovered. Saved settings that can't be read
 * are never silently replaced: the raw text is kept under a ".corrupt-<time>" key, then the
 * backup from the last clean load is used, and only without one are the old pre-settings keys
 * migrated (which keeps just the theme and layout).
 */
export function loadSettingsWithRecovery(): LoadedSettings {
    if (typeof window === 'undefined') {
        return { settings: createDefaultSettings(false), recovery: null }
    }

    const isMac = isMacPlatform()
    const raw = readItem(SETTINGS_STORAGE_KEY)

    if (raw !== null) {
        const stored = readStored(raw, isMac)
        if (stored) {
            if (readItem(SETTINGS_BACKUP_KEY) !== raw) writeItem(SETTINGS_BACKUP_KEY, raw)
            return { settings: stored, recovery: null }
        }

        writeItem(`${SETTINGS_CORRUPT_KEY_PREFIX}${Date.now()}`, raw)
        const restored = readStored(readItem(SETTINGS_BACKUP_KEY), isMac)
        if (restored) {
            saveSettings(restored)
            return { settings: restored, recovery: 'backup' }
        }
    }

    // Nothing saved yet (first launch, or an upgrade from before unified settings), or nothing
    // usable to restore: build settings from the older one-value keys.
    const migrated = migrateLegacySettings(readItem, isMac)
    saveSettings(migrated)
    return { settings: migrated, recovery: raw === null ? null : 'reset' }
}

export function loadSettings(): AppSettings {
    return loadSettingsWithRecovery().settings
}

export function saveSettings(settings: AppSettings): void {
    if (typeof window === 'undefined') return
    // Never overwrite good settings with junk (JSON.stringify(undefined) would store "undefined").
    if (!settings || typeof settings !== 'object') return

    try {
        // Only changed shortcuts are stored, so later default changes still reach this user.
        const keybinds = keybindOverrides(settings.keybinds, createDefaultKeybinds(isMacPlatform()))
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, keybinds }))
        dualWriteLegacyTheme(settings.theme.id)
        dualWriteLegacyLayout(settings.layout)
        dualWriteLegacyAutosave(settings.autosave.enabled)
    } catch {
        // private browsing / quota
    }
}

export { SETTINGS_STORAGE_KEY }
