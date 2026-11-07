import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export const RELEASES_URL = 'https://github.com/Jamie-Fairweather/scrivon/releases/latest'

/** Mirrors `UpdateAttempt` in src-tauri/src/updater.rs. */
type UpdateAttempt = {
    /** The version running now when it installed (perhaps one installed by hand), else the one the update was going to install. */
    version: string
    /** False when the app is still on the version it had before the update. */
    installed: boolean
}

/** In the browser: in the app's window, window.open would open a popup of the app instead. */
async function openReleasesPage(): Promise<void> {
    try {
        await openUrl(RELEASES_URL)
    } catch (err) {
        notifyError("Couldn't open the releases page", err)
    }
}

/**
 * Says how the last in-app update went. The app closes before the installer runs, so without
 * this a declined permission prompt or a blocked installer just looks like the app vanished.
 */
export async function reportLastUpdateAttempt(): Promise<void> {
    if (!isTauri()) return

    let attempt: UpdateAttempt | null
    try {
        attempt = await invoke<UpdateAttempt | null>('take_update_attempt')
    } catch (error) {
        console.warn('Could not check the last update:', error)
        return
    }
    if (!attempt) return

    if (attempt.installed) {
        notifySuccess(`Updated to version ${attempt.version}`)
        return
    }
    notifyWarning(`The update to version ${attempt.version} didn't install`, {
        description: 'The installer may have been blocked, or permission to install was declined. You can download it from the releases page.',
        timeout: 0,
        action: { label: 'Download', onClick: () => void openReleasesPage() },
    })
}
