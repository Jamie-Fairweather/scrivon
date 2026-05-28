export type DocumentKind = 'markdown' | 'mermaid'

export function isMarkdownFile(name: string): boolean {
    return name.toLowerCase().endsWith('.md')
}

export function isMermaidFile(name: string): boolean {
    return name.toLowerCase().endsWith('.mmd')
}

export function isSupportedDocument(name: string): boolean {
    return isMarkdownFile(name) || isMermaidFile(name)
}

export function documentKind(name: string): DocumentKind | null {
    if (isMarkdownFile(name)) return 'markdown'
    if (isMermaidFile(name)) return 'mermaid'
    return null
}
