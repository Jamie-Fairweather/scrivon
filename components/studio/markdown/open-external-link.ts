import { openUrl } from '@tauri-apps/plugin-opener'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'

/** Opens a web, email or phone link from a document in the system's browser or app, never inside Scrivon. */
export function openExternalLink(url: string): void {
    if (!isTauri()) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
    }
    openUrl(url).catch((err: unknown) => notifyError("Couldn't open link", err))
}
