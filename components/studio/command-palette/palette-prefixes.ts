import { foldText } from '@/components/studio/command-palette/fold-text'
import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { HeadingPaletteItem, LinePaletteItem, PrefixPaletteItem } from '@/components/studio/command-palette/types'
import { outlineTree, type OutlineHeading, type OutlineNode } from '@/lib/markdown/document-outline'

/** The open file, as the ':' and '@' prefixes need it. */
export type PaletteFile = { path: string; name: string; content: string }

/** '12', '12:5' or '12,5' (a trailing ':' while the column is still being typed is fine). */
const LINE_TARGET = /^(\d+)\s*(?:[:,]\s*(\d*))?$/

/** How many lines the text has. Counted, not split: splitting a big file on every key would make typing slow. */
function countLines(content: string): number {
    let count = 1
    for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) count++
    return count
}

/** How long a line (from 1) is, without its line ending. */
function lineLength(content: string, line: number): number {
    let start = 0
    for (let n = 1; n < line; n++) start = content.indexOf('\n', start) + 1
    const next = content.indexOf('\n', start)
    const end = next === -1 ? content.length : next
    // A file saved with Windows line endings keeps a hidden return at the end of each line.
    return end > start && content.charAt(end - 1) === '\r' ? end - start - 1 : end - start
}

/** The row that goes to the line typed after ':', kept inside the file. Null until a line number is typed. */
export function goToLineItem(file: PaletteFile, query: string): LinePaletteItem | null {
    const match = LINE_TARGET.exec(query.trim())
    if (!match) return null

    const lineCount = countLines(file.content)
    const line = Math.min(Math.max(1, Number(match[1])), lineCount)
    const typedColumn = match[2] ? Number(match[2]) : null
    const column = typedColumn === null ? 1 : Math.min(Math.max(1, typedColumn), lineLength(file.content, line) + 1)

    let label = `Go to line ${line}`
    if (typedColumn !== null) label += `, column ${column}`
    else if (Number(match[1]) > lineCount) label += ', the last line'

    return {
        kind: 'line',
        value: `line:${line}:${column}`,
        searchText: label,
        path: file.path,
        label,
        detail: `${file.name} · ${lineCount === 1 ? '1 line' : `${lineCount} lines`}`,
        line,
        column,
    }
}

/** How far in each heading sits in the Outline panel's tree, by its place in the list. */
function outlineDepths(headings: readonly OutlineHeading[]): number[] {
    const depths: number[] = []
    const walk = (nodes: OutlineNode[], depth: number) => {
        for (const node of nodes) {
            depths[node.index] = depth
            walk(node.children, depth + 1)
        }
    }
    walk(outlineTree(headings), 0)
    return depths
}

/**
 * The open Markdown file's headings for '@'. With nothing typed: in file order, set in as the Outline panel sets
 * them in. While typing: the best match first, so Enter jumps to it.
 */
export function headingItems(headings: readonly OutlineHeading[], path: string, query: string): HeadingPaletteItem[] {
    const depths = query ? null : outlineDepths(headings)
    const items = headings.map((heading, index): HeadingPaletteItem => ({
        kind: 'heading',
        value: `heading:${index}`,
        searchText: heading.text,
        path,
        headingId: heading.id,
        text: heading.text,
        level: heading.level,
        line: heading.line,
        depth: depths?.[index] ?? 0,
    }))
    if (!query) return items
    return fuzzyRank(items, query, (item) => item.text).map(({ item }) => item)
}

const PREFIXES: ReadonlyArray<{ prefix: string; label: string }> = [
    { prefix: '>', label: 'Run a command' },
    { prefix: ':', label: 'Go to a line in the open file' },
    { prefix: '@', label: 'Jump to a heading in the open Markdown file' },
]

/** The prefixes, for '?'. Each typed word must appear in the prefix or in what it does. */
export function helpItems(query: string): PrefixPaletteItem[] {
    const words = foldText(query).split(/\s+/).filter(Boolean)
    return PREFIXES.map(({ prefix, label }): PrefixPaletteItem => ({
        kind: 'prefix',
        value: `prefix:${prefix}`,
        searchText: `${prefix} ${label}`,
        prefix,
        label,
    })).filter((item) => {
        const text = foldText(item.searchText)
        return words.every((word) => text.includes(word))
    })
}

/** What ':' shows before a line number is typed. */
export function goToLineHint(file: PaletteFile | null): string {
    if (!file) return 'Open a file to go to a line in it.'
    return `Type a line number from 1 to ${countLines(file.content)}. Add :5 to go to a column.`
}
