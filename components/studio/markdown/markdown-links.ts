import { defaultUrlTransform } from 'react-markdown'
import type { FileNode } from '@/lib/workspace/types'

/** Where a link in the Markdown preview points. */
export type MarkdownLinkTarget =
    | { kind: 'none' }
    /** A heading or footnote in the same document. */
    | { kind: 'anchor'; id: string }
    /** Opened in the system browser or mail app. */
    | { kind: 'external'; url: string }
    /** A file on disk, with an optional `#fragment` to scroll to once it is open. */
    | { kind: 'file'; path: string; fragment: string | null }
    /**
     * A file on another computer's shared folder. Never touched: even looking it up makes Windows connect to that
     * computer and send it the user's sign-in.
     */
    | { kind: 'network' }
    /** A relative file link in a document that has no folder on disk (for example an example tab). */
    | { kind: 'unresolved' }
    /** Some other URL scheme the app can't open. */
    | { kind: 'unsupported' }

export type MarkdownLinkContext = {
    /** Path of the open document, or null when it isn't a file on disk. */
    documentPath: string | null
    /** Open folder; links starting with `/` resolve from here, like in a repository. */
    workspaceRoot: string | null
}

const EXTERNAL_SCHEME = /^(https?|mailto|tel):/i
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
/** A Windows path as it arrives in a link: the Markdown parser percent-encodes `\` as `%5C`. */
const WINDOWS_ABSOLUTE_HREF = /^[a-zA-Z]:([\\/]|%5c)/i
/**
 * Two separators at the start, in any mix: a network share (`\\server\share`, `//server/share`) or a device path
 * (`\\?\`, `\\.\`).
 */
const NETWORK_PATH = /^[\\/]{2}/
const NETWORK_SHARE = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

function decode(text: string): string {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}

/**
 * A heading id or `#fragment` reduced the way export makes heading ids (lower case, only letters, digits, `_`,
 * spaces and `-`, one `-` between words), with no `-` at either end. GitHub's own ids keep each `-` and non-English
 * letters (`## Foo & Bar` is `#foo--bar`, `## 🚀 Start` is `#-start`), so a README's table of contents still finds
 * its headings this way.
 */
export function anchorKey(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

/**
 * Keeps Windows paths such as `C:\docs\a.md` (react-markdown's default would blank them, reading `C:` as an
 * unsafe URL scheme) and otherwise applies react-markdown's safe default.
 */
export function markdownUrlTransform(url: string): string {
    if (WINDOWS_ABSOLUTE_HREF.test(url)) return url
    return defaultUrlTransform(url)
}

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

/**
 * `server\share` (lower case) for a path on a network share, '' for a network or device path that names no share
 * Scrivon would open, or null for a local path.
 */
function networkShare(path: string): string | null {
    if (!NETWORK_PATH.test(path)) return null
    const match = NETWORK_SHARE.exec(path)
    if (!match) return ''
    const [, host, share] = match
    if (host === '?' || host === '.') return ''
    return `${host}\\${share}`.toLowerCase()
}

/** The start of a path that `..` can't climb above: `C:`, `\\server\share`, or '' for a POSIX path. */
function pathRoot(path: string): string {
    const network = /^[\\/]{2}[^\\/]*(?:[\\/]+[^\\/]*)?/.exec(path)
    if (network) return network[0]
    return /^[a-zA-Z]:/.exec(path)?.[0] ?? ''
}

/**
 * Appends `segments` to `base`, resolving `.` and `..` (never above the base's drive or share). The base is kept
 * exactly as written so the result matches the paths the explorer and tabs already use; new segments use
 * `separator`.
 */
function joinSegments(base: string, segments: string[], separator: string): string {
    const tokens = base.split(/([/\\])/)
    const rootTokens = pathRoot(base).split(/([/\\])/).length
    for (const segment of segments) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (tokens.length - 2 >= rootTokens) tokens.splice(-2, 2)
            continue
        }
        tokens.push(separator, segment)
    }
    return tokens.join('')
}

function parentFolder(path: string): { folder: string; separator: string } | null {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (index < 0) return null
    return { folder: path.slice(0, index), separator: path[index]! }
}

function resolveFilePath(linkPath: string, { documentPath, workspaceRoot }: MarkdownLinkContext): string | null {
    if (WINDOWS_ABSOLUTE.test(linkPath) || NETWORK_PATH.test(linkPath)) {
        const root = pathRoot(linkPath)
        const rest = linkPath.slice(root.length)
        return joinSegments(root, rest.split(/[/\\]/), rest[0] ?? '\\')
    }

    const segments = linkPath.split(/[/\\]/)

    if (linkPath.startsWith('/')) {
        // Like a repository root, so it needs the open folder; never the root of the disk.
        return workspaceRoot ? joinSegments(workspaceRoot.replace(/[/\\]+$/, ''), segments, '/') : null
    }

    const parent = documentPath ? parentFolder(documentPath) : null
    if (!parent) return null
    return joinSegments(parent.folder, segments, parent.separator)
}

/**
 * Whether a link may lead to `path`. A network share is only followed when the open folder or document is on that
 * same share, so a link can't make Scrivon contact another computer.
 */
function isReachable(path: string, { documentPath, workspaceRoot }: MarkdownLinkContext): boolean {
    const share = networkShare(path)
    if (share === null) return true
    if (!share) return false
    return [documentPath, workspaceRoot].some((open) => open !== null && networkShare(open) === share)
}

/** Works out what clicking a preview link with this `href` should do. */
export function resolveMarkdownLink(href: string | undefined, context: MarkdownLinkContext): MarkdownLinkTarget {
    const value = href?.trim() ?? ''
    if (!value) return { kind: 'none' }

    if (value.startsWith('#')) {
        const id = decode(value.slice(1))
        return id ? { kind: 'anchor', id } : { kind: 'none' }
    }

    if (EXTERNAL_SCHEME.test(value)) return { kind: 'external', url: value }
    if (URL_SCHEME.test(value) && !WINDOWS_ABSOLUTE_HREF.test(value)) return { kind: 'unsupported' }

    const hashIndex = value.indexOf('#')
    const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value
    const fragment = hashIndex >= 0 ? decode(value.slice(hashIndex + 1)) || null : null
    const queryIndex = beforeHash.indexOf('?')
    const linkPath = decode(queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash)

    if (!linkPath) return fragment ? { kind: 'anchor', id: fragment } : { kind: 'none' }

    const path = resolveFilePath(linkPath, context)
    if (!path) return { kind: 'unresolved' }
    if (!isReachable(path, context)) return { kind: 'network' }
    return { kind: 'file', path, fragment }
}

/** Paths on Windows compare without regard to letter case. */
function isWindowsPath(path: string): boolean {
    return /^[a-zA-Z]:/.test(path) || NETWORK_PATH.test(path)
}

function comparablePath(path: string, windows: boolean): string {
    const forward = path.replace(/\\/g, '/')
    return windows ? forward.toLowerCase() : forward
}

/** Same file, allowing for mixed `/` and `\` separators (and letter case on Windows). */
export function isSamePath(a: string, b: string): boolean {
    if (a === b) return true
    const windows = isWindowsPath(a)
    return comparablePath(a, windows) === comparablePath(b, windows)
}

/** Whether `path` (with `.` and `..` already resolved, as links are) is somewhere inside `folder`. */
export function isPathInside(path: string, folder: string): boolean {
    const windows = isWindowsPath(folder)
    const root = comparablePath(folder, windows).replace(/\/+$/, '')
    return comparablePath(path, windows).startsWith(`${root}/`)
}

function findInTree(nodes: readonly FileNode[], path: string): string | null {
    for (const node of nodes) {
        if (node.kind === 'file' && isSamePath(node.path, path)) return node.path
        if (node.kind === 'directory') {
            const found = findInTree(node.children, path)
            if (found) return found
        }
    }
    return null
}

/**
 * The path the explorer has for a file inside the open folder, so a linked file opens in the same tab whether it
 * is opened from a link or from the explorer, however the link spells it. A file the explorer doesn't list gets
 * the explorer's form of the path: the folder as written, then `/` between names.
 */
export function workspaceFilePath(path: string, workspaceRoot: string, tree: readonly FileNode[]): string {
    const listed = findInTree(tree, path)
    if (listed) return listed
    const root = workspaceRoot.replace(/[/\\]+$/, '')
    const names = path.slice(root.length + 1).split(/[/\\]+/)
    return `${root}/${names.join('/')}`
}
