import type { Element, ElementContent, Root as HastRoot } from 'hast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { markdownPreviewBody } from '@/components/studio/markdown/markdown-preview-body'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true })

function textOf(node: Element | ElementContent): string {
    if (node.type === 'text') return node.value
    if (node.type === 'element') return node.children.map(textOf).join('')
    return ''
}

function isMermaidCode(node: Element): boolean {
    if (node.tagName !== 'code') return false
    const classes = node.properties.className
    const list = Array.isArray(classes) ? classes : typeof classes === 'string' ? classes.split(/\s+/) : []
    return list.some((name) => /^language-mermaid$/i.test(String(name)))
}

/**
 * The source of every Mermaid block in the document, in the order MarkdownPreview numbers them. It walks the
 * same HTML tree react-markdown renders, so blocks moved to the end (footnotes) or dropped (unused footnote
 * definitions) line up with the preview.
 */
export function extractMermaidBlockSources(markdown: string): string[] {
    const tree = processor.runSync(processor.parse(markdownPreviewBody(markdown))) as HastRoot
    const sources: string[] = []
    visit(tree, 'element', (node: Element) => {
        if (isMermaidCode(node)) sources.push(textOf(node).replace(/\n$/, ''))
    })
    return sources
}

export type MermaidBlockPosition = { ordinal: number; source: string }

/**
 * Finds an expanded block again after the document changed. With the same number of blocks, the block at its
 * position is the one being edited. When blocks were added or removed, it is found by its unchanged source.
 * Returns null when it can't be found, so the caller closes it rather than showing some other diagram.
 */
export function locateMermaidBlock(block: MermaidBlockPosition, sources: string[], previousCount: number | null): MermaidBlockPosition | null {
    const { ordinal, source } = block
    if (sources[ordinal] === source) return block

    const countChanged = previousCount !== null && previousCount !== sources.length
    if (countChanged) {
        const moved = sources.indexOf(source)
        return moved >= 0 ? { ordinal: moved, source } : null
    }

    return ordinal < sources.length ? { ordinal, source: sources[ordinal]! } : null
}
