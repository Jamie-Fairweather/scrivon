import type { Monaco } from '@monaco-editor/react'
import type { Uri } from 'monaco-editor'
import { openUrl } from '@tauri-apps/plugin-opener'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'

/** Link types Ctrl+Click hands to the system. The opener plugin's default permission allows these. */
const EXTERNAL_LINK_SCHEMES = new Set(['http', 'https', 'mailto'])

const registeredFor = new WeakSet<object>()

/**
 * Monaco opens a Ctrl+Clicked link with window.open, which the desktop app's webview silently
 * drops. In the desktop app, web and email links go to the system's browser or mail app instead.
 * Other links (and the browser build) keep Monaco's own handling.
 */
export function registerExternalLinkOpener(monaco: Monaco): void {
    if (registeredFor.has(monaco)) return
    registeredFor.add(monaco)
    monaco.editor.registerLinkOpener({
        async open(resource: Uri) {
            if (!isTauri() || !EXTERNAL_LINK_SCHEMES.has(resource.scheme)) return false
            // The same text Monaco would give window.open.
            const url = encodeURI(resource.toString(true))
            try {
                await openUrl(url)
            } catch (err) {
                notifyError("Couldn't open link", err)
            }
            return true
        },
    })
}
