import type { Element, ElementContent, Root as HastRoot } from 'hast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { mermaidBlockOrdinal, rehypeFencedBlockOrdinals } from '@/components/studio/markdown/markdown-block-ordinals'
import { markdownPreviewBody } from '@/components/studio/markdown/markdown-preview-body'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeFencedBlockOrdinals)

function textOf(node: Element | ElementContent): string {
    if (node.type === 'text') return node.value
    if (node.type === 'element') return node.children.map(textOf).join('')
    return ''
}

/**
 * The source of every Mermaid block in the document, by the ordinal MarkdownPreview gives it. Both number the
 * blocks with the same plugin on the same HTML tree react-markdown renders, so blocks moved to the end (footnotes)
 * or dropped (unused footnote definitions) line up with the preview.
 */
export function extractMermaidBlockSources(markdown: string): string[] {
    const tree = processor.runSync(processor.parse(markdownPreviewBody(markdown))) as HastRoot
    const sources: string[] = []
    visit(tree, 'element', (node: Element) => {
        const ordinal = mermaidBlockOrdinal(node)
        if (ordinal !== null) sources[ordinal] = textOf(node).replace(/\n$/, '')
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
