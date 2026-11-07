export type DocumentKind = 'markdown' | 'mermaid'

export function isMarkdownFile(name: string): boolean {
    return name.toLowerCase().endsWith('.md')
}

export function isMermaidFile(name: string): boolean {
    const lower = name.toLowerCase()
    return lower.endsWith('.mmd') || lower.endsWith('.mermaid')
}

export function isSupportedDocument(name: string): boolean {
    return isMarkdownFile(name) || isMermaidFile(name)
}

export function documentKind(name: string): DocumentKind | null {
    if (isMarkdownFile(name)) return 'markdown'
    if (isMermaidFile(name)) return 'mermaid'
    return null
}

/** The extensions of the files Scrivon opens, in the order messages list them. */
const SUPPORTED_EXTENSIONS = ['.md', '.mmd', '.mermaid']

/** The supported extensions for a message: `.md, .mmd and .mermaid` (or `or`), so no message leaves one out. */
export function supportedExtensionsLabel(conjunction: 'and' | 'or'): string {
    return `${SUPPORTED_EXTENSIONS.slice(0, -1).join(', ')} ${conjunction} ${SUPPORTED_EXTENSIONS.at(-1)}`
}

const DOCUMENT_EXTENSIONS = ['.mermaid', '.mmd', '.md']

/** The extension that makes `name` a document Scrivon opens, as written (`.md`, `.MMD`, `.mermaid`), or null. */
export function documentExtension(name: string): string | null {
    const lower = name.toLowerCase()
    const ext = DOCUMENT_EXTENSIONS.find((e) => lower.endsWith(e))
    return ext ? name.slice(name.length - ext.length) : null
}

/** Adds `extension` unless `name` already ends in one Scrivon opens: `login flow` becomes `login flow.mmd`. */
export function withDocumentExtension(name: string, extension: string): string {
    return !name || isSupportedDocument(name) ? name : `${name}${extension}`
}
