import type { Heading, Root } from 'mdast'
import { visit } from 'unist-util-visit'

export type PdfExportOutlineItem = {
    id: string
    level: number
    text: string
}

/**
 * GitHub's heading id (the github-slugger rules), so a `#…` link written for GitHub reaches
 * the same heading here: lower-cased, punctuation and symbols dropped, letters of any script
 * kept, and each space its own `-`. A repeat gets the first free `-1`, `-2`, … suffix.
 */
function slugify(text: string, used: Set<string>): string {
    const base =
        text
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
            .replace(/ /g, '-') || 'section'
    let slug = base
    for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`
    used.add(slug)
    return slug
}

/**
 * The plain text of an mdast node: its inline markup dropped, image and break nodes left out. Raw HTML (a tag or a
 * `<!-- comment -->`) is left out too, so `## Keys <kbd>Ctrl</kbd>` reads 'Keys Ctrl' and a hidden note never
 * reaches the Contents page, the title or the heading's id.
 */
export function nodeText(node: { type?: string; value?: string; children?: unknown[] }): string {
    if (node.type === 'html') return ''
    if (typeof node.value === 'string') return node.value
    if (!Array.isArray(node.children)) return ''
    return node.children.map((child) => nodeText(child as { type?: string; value?: string; children?: unknown[] })).join('')
}

/**
 * Every heading in the parsed document, in order, with a unique slug id. The
 * same id is written onto the heading node (`hProperties.id`) so the rendered
 * HTML and the TOC agree by construction. Works from the tree rather than raw
 * lines, so `#` inside fenced code never leaks in and setext headings count.
 */
export function collectPdfExportOutline(tree: Root): PdfExportOutlineItem[] {
    const used = new Set<string>()
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
