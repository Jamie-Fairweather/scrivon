import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

/** The blocks that get their source line: enough to line the preview up with the editor, and to jump back from it. */
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'pre', 'table', 'tr', 'hr', 'details', 'div', 'dt', 'dd'])

/**
 * Rehype plugin that puts on each block the line of the document it starts on, as `data-source-line`. `firstLine`
 * is the document line the parsed text starts on, as the preview leaves front matter out. Run after the sanitizer,
 * which would drop the attribute.
 */
export function rehypeSourceLines(firstLine: number) {
    return () => (tree: Root) => {
        visit(tree, 'element', (node: Element) => {
            const line = node.position?.start.line
            if (line !== undefined && BLOCK_TAGS.has(node.tagName)) node.properties.dataSourceLine = line + firstLine - 1
        })
    }
}

/** The source line an element was given, for the elements that draw a block themselves. */
export function sourceLineProps(props: object): { 'data-source-line'?: number } {
    const line = (props as { 'data-source-line'?: unknown })['data-source-line']
    return typeof line === 'number' ? { 'data-source-line': line } : {}
}
