import type { Heading, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'
import { collectPdfExportOutline, type PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'

/** A heading in the Outline panel: its id in the preview, its level (1–6), its text and its line in the file (from 1). */
export type OutlineHeading = PdfExportOutlineItem & { line: number }

const parser = unified().use(remarkParse).use(markdownRemarkPlugins).freeze()

/**
 * Every heading in a Markdown document, in order. Read the way the preview reads it (front matter left out, the
 * same plugins and the same ids), so each heading's id is the one the preview gives it. Lines count from the top
 * of the file, front matter included, as the editor counts them.
 */
export function markdownOutline(source: string): OutlineHeading[] {
    const { body } = parsePdfExportFrontMatter(source)
    const linesBefore = source.slice(0, source.length - body.length).split('\n').length - 1
    const tree = parser.parse(body) as Root
    const items = collectPdfExportOutline(tree)

    // collectPdfExportOutline wrote each listed heading's id onto its node; the parser gave every node its place.
    const lineById = new Map<unknown, number>()
    visit(tree, 'heading', (node: Heading) => {
        lineById.set(node.data?.hProperties?.id, node.position!.start.line + linesBefore)
    })
    return items.map((item) => ({ ...item, line: lineById.get(item.id)! }))
}

/** {@link markdownOutline}, or no headings when the parser can't take the text (thousands of nested quotes). */
export function readOutline(source: string): OutlineHeading[] {
    try {
        return markdownOutline(source)
    } catch {
        return []
    }
}

/** Whether two outlines list the same headings on the same lines. */
export function sameOutline(a: readonly OutlineHeading[], b: readonly OutlineHeading[]): boolean {
    return (
        a.length === b.length &&
        a.every((heading, i) => {
            const other = b[i]!
            return heading.id === other.id && heading.level === other.level && heading.text === other.text && heading.line === other.line
        })
    )
}

/** A heading in the outline's tree, with the headings below it. `index` is its place in the flat list. */
export type OutlineNode = { heading: OutlineHeading; index: number; children: OutlineNode[] }

/**
 * The headings as a tree: each one sits under the closest heading above it with a lower level, so an H4 straight
 * after an H2 is one step in, not two.
 */
export function outlineTree(headings: readonly OutlineHeading[]): OutlineNode[] {
    const roots: OutlineNode[] = []
    const open: OutlineNode[] = []
    headings.forEach((heading, index) => {
        const node: OutlineNode = { heading, index, children: [] }
        while (open.length > 0 && open.at(-1)!.heading.level >= heading.level) open.pop()
        const parent = open.at(-1)
        if (parent) parent.children.push(node)
        else roots.push(node)
        open.push(node)
    })
    return roots
}

/** The place in `headings` of the section that holds `line`: the last heading at or above it. -1 when there is none. */
export function headingAtLine(headings: readonly OutlineHeading[], line: number | null): number {
    if (line === null) return -1
    let low = 0
    let high = headings.length - 1
    let found = -1
    while (low <= high) {
        const middle = (low + high) >> 1
        if (headings[middle]!.line <= line) {
            found = middle
            low = middle + 1
        } else {
            high = middle - 1
        }
    }
    return found
}
