import { foldText } from '@/components/studio/command-palette/fold-text'
import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { HeadingPaletteItem, LinePaletteItem, PrefixPaletteItem } from '@/components/studio/command-palette/types'
import type { OutlineHeading } from '@/lib/markdown/document-outline'

/** The open file, as the ':' and '@' prefixes need it. */
export type PaletteFile = { path: string; name: string; content: string }

/** '12', '12:5' or '12,5' (a trailing ':' while the column is still being typed is fine). */
const LINE_TARGET = /^(\d+)\s*(?:[:,]\s*(\d*))?$/

function fileLines(content: string): string[] {
    return content.split('\n')
}

/** The row that goes to the line typed after ':', kept inside the file. Null until a line number is typed. */
export function goToLineItem(file: PaletteFile, query: string): LinePaletteItem | null {
    const match = LINE_TARGET.exec(query.trim())
    if (!match) return null

    const lines = fileLines(file.content)
    const line = Math.min(Math.max(1, Number(match[1])), lines.length)
    const typedColumn = match[2] ? Number(match[2]) : null
    // A file saved with Windows line endings keeps a hidden return at the end of each line.
    const lineLength = lines[line - 1]!.replace(/\r$/, '').length
    const column = typedColumn === null ? 1 : Math.min(Math.max(1, typedColumn), lineLength + 1)

    let label = `Go to line ${line}`
    if (typedColumn !== null) label += `, column ${column}`
    else if (Number(match[1]) > lines.length) label += ', the last line'

    return {
        kind: 'line',
        value: `line:${line}:${column}`,
        searchText: label,
        path: file.path,
        label,
        detail: `${file.name} · ${lines.length === 1 ? '1 line' : `${lines.length} lines`}`,
        line,
        column,
    }
}

/**
 * The open Markdown file's headings for '@'. With nothing typed: in file order, set in like the outline.
 * While typing: the best match first, so Enter jumps to it.
 */
export function headingItems(headings: readonly OutlineHeading[], path: string, query: string): HeadingPaletteItem[] {
    const topLevel = Math.min(...headings.map((heading) => heading.level))
    const items = headings.map((heading, index): HeadingPaletteItem => ({
        kind: 'heading',
        value: `heading:${index}`,
        searchText: heading.text,
        path,
        headingId: heading.id,
        text: heading.text,
        line: heading.line,
        depth: query ? 0 : heading.level - topLevel,
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
    return `Type a line number from 1 to ${fileLines(file.content).length}. Add :5 to go to a column.`
}
