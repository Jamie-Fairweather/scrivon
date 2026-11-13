/** The app's own page address on Windows, where the PDF's print path shows the export page (in an iframe). */
const APP_PAGE_URL = 'http://tauri.localhost/'

/**
 * Whether showing an image from `src` on a page at `pageUrl` would fetch it from another site. Decided by reading
 * the address the way the webview does (`https:host/x.png` means `https://host/x.png`), not by how it is spelled.
 * An address that can't be read counts as a web image, so it stays blocked.
 */
export function isWebImageUrl(src: string, pageUrl: string): boolean {
    try {
        const page = new URL(pageUrl)
        const image = new URL(src, page)
        if (image.protocol !== 'http:' && image.protocol !== 'https:') return false
        return image.origin !== page.origin
    } catch {
        return true
    }
}

/** A web image's full address, as the app's page reads it (`//host/x.png` is `http://host/x.png`). Throws when it can't be read. */
export function webImageAddress(src: string): string {
    return new URL(src.trim(), APP_PAGE_URL).href
}

/**
 * Whether an image in an exported PDF would be fetched from the web. The export page is shown in two places: inside
 * the app (the print dialog's frame, at the app's own address) and, on Windows, in a blank page of its own, where
 * every http: or https: address is fetched as written (`http:host/x.png` included). It counts if either page would
 * fetch it. Relative paths and data: URLs never are.
 */
export function isExportWebImageUrl(src: string): boolean {
    if (isWebImageUrl(src, APP_PAGE_URL)) return true
    try {
        const { protocol } = new URL(src)
        return protocol === 'http:' || protocol === 'https:'
    } catch {
        // Not an address on its own, so the blank page can't load it: a relative path.
        return false
    }
}
