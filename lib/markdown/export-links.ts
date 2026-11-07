import { defaultUrlTransform } from 'react-markdown'

/**
 * Two separators at the start, in any mix and however spelled: a network share or device path (`\\server\share`,
 * `//server/share`, `\\?\`). Word opens one as a share on the other computer, which sends it the reader's Windows
 * sign-in; the preview never opens one either.
 */
const NETWORK_PATH = /^(?:[\\/]|%5c|%2f){2}/i

/** The address as a browser or Word reads it: spaces and control characters before it, and tabs and line breaks in it, don't count. */
function readAddress(url: string): string {
    let start = 0
    while (start < url.length && url.charCodeAt(start) <= 0x20) start++
    return url.slice(start).replace(/[\t\n\r]/g, '')
}

/**
 * A link's address as the PDF and Word file may keep it, or null when it must not stay a live link. Like the
 * preview, only web, email and relative addresses pass (react-markdown's safe list): `javascript:`, `file:`,
 * `search-ms:`, Windows paths and network shares would open programs or files on the reader's computer, or
 * connect it to another one, from a shared document.
 */
export function safeExportHref(url: string): string | null {
    if (NETWORK_PATH.test(readAddress(url))) return null
    return defaultUrlTransform(url) || null
}

function safeDecode(text: string): string {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}

/**
 * The id a `#fragment` link points at: the fragment as written, else percent-decoded (a link copied from a browser's
 * address bar, which the Markdown parser keeps encoded), else that in lower case (`#Résumé` for the heading id
 * `résumé`). Unchanged when no id matches.
 */
export function resolveHeadingAnchor(fragment: string, ids: { has(id: string): boolean }): string {
    const decoded = safeDecode(fragment)
    return [fragment, decoded, decoded.toLowerCase()].find((candidate) => ids.has(candidate)) ?? fragment
}
