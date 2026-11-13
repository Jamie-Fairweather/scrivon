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
import { mirrorSettingsFile } from '@/lib/settings/settings-file'
import type { AppSettings } from '@/lib/settings/types'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

/** The last settings that loaded cleanly, kept so unreadable settings can be restored. */
export const SETTINGS_BACKUP_KEY = `${SETTINGS_STORAGE_KEY}.bak`
/** Unreadable settings are copied to this prefix plus a timestamp before anything replaces them. */
export const SETTINGS_CORRUPT_KEY_PREFIX = `${SETTINGS_STORAGE_KEY}.corrupt-`
/** Settings saved by a newer Scrivon are copied to this prefix plus its version, once, before this one writes. */
export const SETTINGS_NEWER_COPY_KEY_PREFIX = `${SETTINGS_STORAGE_KEY}.from-version-`
/** A second copy of the export profiles: Scrivon 1.4.2 and older drop them when they save settings. */
export const SETTINGS_PDF_EXPORT_KEY = `${SETTINGS_STORAGE_KEY}.pdf-export`
/** The layout of saved settings. A higher number means a newer Scrivon wrote them. */
export const SETTINGS_SCHEMA_VERSION = 1

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

type StoredRecord = Record<string, unknown>

/** Saved settings as written (newer versions' fields included), and what this version made of them. */
type StoredSettings = {
    text: string
    raw: StoredRecord
    settings: AppSettings
}

/** The settings last read or written, so a save keeps what this version doesn't know about. */
let lastStored: StoredSettings | null = null

function isRecord(value: unknown): value is StoredRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Older versions drop export profiles when they save; bring them back from their own copy. */
function withPdfExportCopy(raw: StoredRecord): StoredRecord {
    if (raw.pdfExport !== undefined) return raw
    const copy = readItem(SETTINGS_PDF_EXPORT_KEY)
    if (copy === null) return raw
    try {
        return { ...raw, pdfExport: JSON.parse(copy) as unknown }
    } catch {
        return raw
    }
}

/** Settings read from saved text, or null when the text is missing or isn't a settings object. */
function readStored(text: string | null, isMac: boolean): StoredSettings | null {
    if (text === null) return null
    try {
        const parsed: unknown = JSON.parse(text)
        if (!isRecord(parsed)) return null
        const raw = withPdfExportCopy(parsed)
        return { text, raw, settings: mergeStoredSettings(raw, isMac) }
    } catch {
        return null
    }
}

/** Before this version writes over settings from a newer one, keep an untouched copy. */
function keepNewerVersionCopy(stored: StoredSettings): void {
    const version = stored.raw.schemaVersion
    if (typeof version !== 'number' || version <= SETTINGS_SCHEMA_VERSION) return
    const key = `${SETTINGS_NEWER_COPY_KEY_PREFIX}${version}`
    if (readItem(key) === null) writeItem(key, stored.text)
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
            keepNewerVersionCopy(stored)
            if (readItem(SETTINGS_BACKUP_KEY) !== raw) writeItem(SETTINGS_BACKUP_KEY, raw)
            // Settings saved before settings.json existed get their copy now, not at the first change.
            mirrorSettingsFile(stored.raw)
            lastStored = stored
            return { settings: stored.settings, recovery: null }
        }

        writeItem(`${SETTINGS_CORRUPT_KEY_PREFIX}${Date.now()}`, raw)
        const restored = readStored(readItem(SETTINGS_BACKUP_KEY), isMac)
        if (restored) {
            lastStored = restored
            saveSettings(restored.settings)
            return { settings: restored.settings, recovery: 'backup' }
        }
    }

    lastStored = null

    // Nothing saved yet (first launch, or an upgrade from before unified settings), or nothing
    // usable to restore: build settings from the older one-value keys.
    const migrated = migrateLegacySettings(readItem, isMac)
    saveSettings(migrated)
    return { settings: migrated, recovery: raw === null ? null : 'reset' }
}

/**
 * Reads the saved settings without changing anything: no backup, no copies, no save. For code
 * that only needs a current value (the recent-folders limit); the app loads settings once, at
 * startup, with loadSettingsWithRecovery. Falls back the same way: the backup when the saved
 * copy can't be read, then the old pre-settings keys.
 */
export function loadSettings(): AppSettings {
    if (typeof window === 'undefined') return createDefaultSettings(false)

    const isMac = isMacPlatform()
    const raw = readItem(SETTINGS_STORAGE_KEY)
    const stored = readStored(raw, isMac) ?? (raw === null ? null : readStored(readItem(SETTINGS_BACKUP_KEY), isMac))
    return stored?.settings ?? migrateLegacySettings(readItem, isMac)
}

function isEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => isEqual(item, b[index]))
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a)
        return keys.length === Object.keys(b).length && keys.every((key) => isEqual(a[key], b[key]))
    }
    return false
}

function hasId(value: unknown): value is { id: string } {
    return isRecord(value) && typeof value.id === 'string'
}

/**
 * Lays the settings to save over the stored ones without losing what this version can't read.
 * stored is what was saved, loaded is what this version made of it, next is what to save now.
 * Fields this version doesn't know are kept. A value that hasn't changed since loading keeps
 * the stored value, even one this version can't use (a newer theme or page size). Lists of
 * things with ids (export profiles) are matched by id, so each keeps its own unknown fields.
 */
function mergeOntoStored(stored: unknown, loaded: unknown, next: unknown): unknown {
    if (isRecord(next)) {
        const from = isRecord(stored) ? stored : {}
        const was = isRecord(loaded) ? loaded : {}
        const merged: StoredRecord = {}
        for (const [key, value] of Object.entries(from)) {
            if (!(key in was) && !(key in next)) merged[key] = value
        }
        for (const [key, value] of Object.entries(next)) {
            merged[key] = mergeOntoStored(from[key], was[key], value)
        }
        return merged
    }
    if (Array.isArray(next) && next.every(hasId)) {
        const storedList = Array.isArray(stored) ? stored.filter(hasId) : []
        const loadedList = Array.isArray(loaded) ? loaded.filter(hasId) : []
        return next.map((item) =>
            mergeOntoStored(
                storedList.find((entry) => entry.id === item.id),
                loadedList.find((entry) => entry.id === item.id),
                item
            )
        )
    }
    return stored !== undefined && isEqual(next, loaded) ? stored : next
}

/** The stored settings to build on: the last ones read or written, unless something else wrote since. */
function currentStored(isMac: boolean): StoredSettings | null {
    const text = readItem(SETTINGS_STORAGE_KEY)
    if (text === null) return null
    if (lastStored?.text === text) return lastStored
    return readStored(text, isMac) ?? lastStored
}

function withoutKeybinds(value: object): StoredRecord {
    const copy: StoredRecord = { ...value }
    delete copy.keybinds
    return copy
}

/**
 * Settings as they are saved: only the shortcuts the user changed, so later default changes still reach
 * them, and the schema version. Settings files exported from Settings hold this too.
 */
export function settingsToStore(settings: AppSettings, isMac = isMacPlatform()): StoredRecord {
    const overrides = keybindOverrides(settings.keybinds, createDefaultKeybinds(isMac))
    return { ...withoutKeybinds(settings), keybinds: overrides, schemaVersion: SETTINGS_SCHEMA_VERSION }
}

/** What to write for these settings, keeping fields, values and shortcuts from a newer version. */
function toStored(settings: AppSettings, isMac: boolean): StoredRecord {
    const defaults = createDefaultKeybinds(isMac)
    const overrides = keybindOverrides(settings.keybinds, defaults)
    const base = currentStored(isMac)
    if (!base) return settingsToStore(settings, isMac)

    const merged = mergeOntoStored(withoutKeybinds(base.raw), withoutKeybinds(base.settings), withoutKeybinds(settings)) as StoredRecord
    // Shortcuts for actions this version doesn't have are kept as they were.
    const storedKeybinds = isRecord(base.raw.keybinds) ? base.raw.keybinds : {}
    const unknownActions = Object.fromEntries(Object.entries(storedKeybinds).filter(([actionId]) => !(actionId in defaults)))
    return { ...merged, keybinds: { ...unknownActions, ...overrides }, schemaVersion: SETTINGS_SCHEMA_VERSION }
}

export function saveSettings(settings: AppSettings): void {
    if (typeof window === 'undefined') return
    // Never overwrite good settings with junk (JSON.stringify(undefined) would store "undefined").
    if (!settings || typeof settings !== 'object') return

    try {
        const raw = toStored(settings, isMacPlatform())
        const text = JSON.stringify(raw)
        localStorage.setItem(SETTINGS_STORAGE_KEY, text)
        lastStored = { text, raw, settings }
        mirrorSettingsFile(raw)
        writeItem(SETTINGS_PDF_EXPORT_KEY, JSON.stringify(raw.pdfExport))
        dualWriteLegacyTheme(settings.theme.id)
        dualWriteLegacyLayout(settings.layout)
        dualWriteLegacyAutosave(settings.autosave.enabled)
    } catch {
        // private browsing / quota
    }
}

export { SETTINGS_STORAGE_KEY }
