import type { IDisposable, Uri } from 'monaco-editor'
import { openUrl } from '@tauri-apps/plugin-opener'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'

/** Link types Ctrl+Click hands to the system. The opener plugin's default permission allows these. */
const EXTERNAL_LINK_SCHEMES = new Set(['http', 'https', 'mailto'])

/** What Monaco's opener service asks an opener to open: a detected link's text, or a parsed Uri. */
export type LinkTarget = string | Uri

/** The part of Monaco's opener service (IOpenerService) used here. */
export type LinkOpenerService = {
    registerOpener(opener: { open(target: LinkTarget): Promise<boolean> }): IDisposable
}

/**
 * The address to hand the system. A detected link is used exactly as written: parsing it would
 * decode %26, %2F or %23 and change the address. A Uri is turned into text the way Monaco does.
 */
export function linkHref(target: LinkTarget): string {
    return typeof target === 'string' ? target : encodeURI(target.toString(true))
}

function linkScheme(href: string): string | undefined {
    return /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1]?.toLowerCase()
}

const registeredFor = new WeakSet<object>()

/**
 * Monaco opens a Ctrl+Clicked link with window.open, which the desktop app's webview silently
 * drops. In the desktop app, web and email links go to the system's browser or mail app instead.
 * Other links (and the browser build) keep Monaco's own handling.
 *
 * Registered with the opener service itself rather than monaco.editor.registerLinkOpener, which
 * parses the link text into a Uri first. Openers registered here are asked before Monaco's own.
 */
export function registerExternalLinkOpener(openerService: LinkOpenerService): void {
    if (registeredFor.has(openerService)) return
    registeredFor.add(openerService)
    openerService.registerOpener({
        async open(target) {
            if (!isTauri()) return false
            const href = linkHref(target)
            const scheme = linkScheme(href)
            if (!scheme || !EXTERNAL_LINK_SCHEMES.has(scheme)) return false
            try {
                await openUrl(href)
            } catch (err) {
                notifyError("Couldn't open link", err)
            }
            return true
        },
    })
}
