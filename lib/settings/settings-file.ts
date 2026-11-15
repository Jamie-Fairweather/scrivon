import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

/**
 * A copy of the saved settings in settings.json, in Scrivon's data folder (src-tauri/src/settings_file.rs).
 * Settings live in the web view's storage, which clearing the WebView2 cache wipes. When the app then starts
 * with no settings there, Rust puts this copy back before the page loads.
 */

/** The text last asked for, so the same settings aren't written twice in a row. */
let requested: string | null = null
/** Waiting for the write in progress to finish. Only the latest is kept. */
let pending: string | null = null
let writing: Promise<void> | null = null

async function writeAll(): Promise<void> {
    while (pending !== null) {
        const text = pending
        pending = null
        try {
            await invoke('save_settings_file', { text })
        } catch (err) {
            console.warn("Couldn't save the copy of the settings", err)
            // Try again with the next save, even when it's the same.
            if (pending === null && requested === text) requested = null
        }
    }
    writing = null
}

/** Saves `stored` (the settings as kept in web storage) to settings.json, one write at a time. */
export function mirrorSettingsFile(stored: Record<string, unknown>): void {
    if (!isTauri()) return
    const text = JSON.stringify(stored, null, 2)
    if (text === requested) return
    requested = text
    pending = text
    writing ??= writeAll()
}

/** Resolves once every copy asked for so far has been written (or failed). */
export function settingsFileSaved(): Promise<void> {
    return writing ?? Promise.resolve()
}
