import type { Heading, Root } from 'mdast'
import { visit } from 'unist-util-visit'

export type PdfExportOutlineItem = {
    id: string
    level: number
    text: string
}

function slugify(text: string, used: Map<string, number>): string {
    const base =
        text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-') || 'section'
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
}

function nodeText(node: { value?: string; children?: unknown[] }): string {
    if (typeof node.value === 'string') return node.value
    if (!Array.isArray(node.children)) return ''
    return node.children.map((child) => nodeText(child as { value?: string; children?: unknown[] })).join('')
}

/**
 * Every heading in the parsed document, in order, with a unique slug id. The
 * same id is written onto the heading node (`hProperties.id`) so the rendered
 * HTML and the TOC agree by construction. Works from the tree rather than raw
 * lines, so `#` inside fenced code never leaks in and setext headings count.
 */
export function collectPdfExportOutline(tree: Root): PdfExportOutlineItem[] {
    const used = new Map<string, number>()
    const items: PdfExportOutlineItem[] = []
    visit(tree, 'heading', (node: Heading) => {
        const text = nodeText(node).trim()
        if (!text) return
        const id = slugify(text, used)
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } }
        items.push({ id, level: node.depth, text })
    })
    return items
}

/** The outline rows a TOC should show for the profile's depth / H1 settings. */
export function filterPdfExportOutline(items: PdfExportOutlineItem[], maxDepth: number, excludeH1: boolean): PdfExportOutlineItem[] {
    return items.filter((item) => item.level <= maxDepth && !(excludeH1 && item.level === 1))
}
