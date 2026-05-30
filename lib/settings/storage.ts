import { isMacPlatform } from '@/lib/settings/chord-utils'
import { createDefaultSettings } from '@/lib/settings/defaults'
import {
    dualWriteLegacyAutosave,
    dualWriteLegacyLayout,
    dualWriteLegacyTheme,
    mergeStoredSettings,
    migrateLegacySettings,
} from '@/lib/settings/migrate'
import type { AppSettings } from '@/lib/settings/types'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

export function loadSettings(): AppSettings {
    if (typeof window === 'undefined') {
        return createDefaultSettings(false)
    }

    const isMac = isMacPlatform()

    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
        if (raw) {
            return mergeStoredSettings(JSON.parse(raw), isMac)
        }
    } catch {
        // fall through to migration
    }

    const migrated = migrateLegacySettings((key) => {
        try {
            return localStorage.getItem(key)
        } catch {
            return null
        }
    }, isMac)

    saveSettings(migrated)
    return migrated
}

export function saveSettings(settings: AppSettings): void {
    if (typeof window === 'undefined') return

    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
        dualWriteLegacyTheme(settings.theme.id)
        dualWriteLegacyLayout(settings.layout)
        dualWriteLegacyAutosave(settings.autosave.enabled)
    } catch {
        // private browsing / quota
    }
}

export { SETTINGS_STORAGE_KEY }
