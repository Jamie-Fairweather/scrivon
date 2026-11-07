import { defaultUrlTransform } from 'react-markdown'

/**
 * A link's address as the PDF and Word file may keep it, or null when it must not stay a live link. Like the
 * preview, only web, email and relative addresses pass (react-markdown's safe list): `javascript:`, `file:`,
 * `search-ms:` and Windows paths would open programs or files on the reader's computer from a shared document.
 */
export function safeExportHref(url: string): string | null {
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
