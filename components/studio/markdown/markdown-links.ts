import { defaultUrlTransform } from 'react-markdown'

/** Where a link in the Markdown preview points. */
export type MarkdownLinkTarget =
    | { kind: 'none' }
    /** A heading or footnote in the same document. */
    | { kind: 'anchor'; id: string }
    /** Opened in the system browser or mail app. */
    | { kind: 'external'; url: string }
    /** A file on disk, with an optional `#fragment` to scroll to once it is open. */
    | { kind: 'file'; path: string; fragment: string | null }
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
const UNC_PATH = /^\\\\/
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

function decode(text: string): string {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
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
 * Appends `segments` to `base`, resolving `.` and `..`. The base is kept exactly as written so the result
 * matches the paths the explorer and tabs already use; new segments use `separator`.
 */
function joinSegments(base: string, segments: string[], separator: string): string {
    const tokens = base.split(/([/\\])/)
    for (const segment of segments) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (tokens.length >= 3) tokens.splice(-2, 2)
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
    if (WINDOWS_ABSOLUTE.test(linkPath) || UNC_PATH.test(linkPath)) return linkPath

    const segments = linkPath.split(/[/\\]/)

    if (linkPath.startsWith('/')) {
        if (workspaceRoot) return joinSegments(workspaceRoot.replace(/[/\\]+$/, ''), segments, '/')
        return linkPath
    }

    const parent = documentPath ? parentFolder(documentPath) : null
    if (!parent) return null
    return joinSegments(parent.folder, segments, parent.separator)
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
    return { kind: 'file', path, fragment }
}
