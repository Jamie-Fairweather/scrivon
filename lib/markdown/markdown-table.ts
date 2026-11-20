/**
 * GFM tables in the Markdown editor: insert one, add, delete and move its rows and columns, set a
 * column's alignment, and line its pipes up. Works on lines of plain text and knows nothing about the
 * editor (lib/monaco/markdown-editing.ts applies the result), so a file keeps its own line endings.
 *
 * Format Table writes one exact layout, so a tidy table is never changed: one space each side of every
 * pipe, leading and trailing pipes, and each column as wide as its widest cell (at least 3, so the
 * delimiter keeps its colons). No text is ever thrown away: a short row gets empty cells, and extra
 * cells on a long row are kept after the last column.
 */

import { eastAsianWidthType } from 'get-east-asian-width'
import { insideCodeBlock } from '@/lib/markdown/code-blocks'

export type ColumnAlignment = 'left' | 'center' | 'right' | 'none'

/** A place in the text: a line and a column in it, both from 0. */
export type TextCaret = { line: number; column: number }

/** Replace lines `start` to `end` (from 0, `end` not included) with `lines`. With start === end, `lines` go in before line `start`. */
export type LinesEdit = { start: number; end: number; lines: string[] }

/** What a table command does: the edit and where the caret goes in the text after it, or why it does nothing. */
export type TableEditResult =
    | { status: 'edited'; edit: LinesEdit; caret: TextCaret }
    /** The command can't change this table (moving the header row, deleting the only column…), or it is already tidy. */
    | { status: 'unchanged' }
    | { status: 'no-table' }
    | { status: 'code-block' }

export type TableAction =
    | 'insert-row-above'
    | 'insert-row-below'
    | 'delete-row'
    | 'move-row-up'
    | 'move-row-down'
    | 'insert-column-left'
    | 'insert-column-right'
    | 'delete-column'
    | 'move-column-left'
    | 'move-column-right'
    | 'align-left'
    | 'align-center'
    | 'align-right'
    | 'align-none'
    | 'format'

/** The size of a new table: columns, and rows under the header. */
export type TableSize = { columns: number; rows: number }

export const TABLE_COLUMNS = { min: 1, max: 20, default: 3 } as const
export const TABLE_ROWS = { min: 1, max: 100, default: 2 } as const

/** The narrowest a column is written, so `:-:` fits. */
const MIN_WIDTH = 3

// --- Width on screen ---

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u
const PLAIN_ASCII = /^[\x20-\x7e]*$/

function graphemeWidth(grapheme: string): 1 | 2 {
    const type = eastAsianWidthType(grapheme.codePointAt(0) ?? 0)
    if (type === 'wide' || type === 'fullwidth') return 2
    if (grapheme.includes('️') || EMOJI_PRESENTATION.test(grapheme)) return 2
    // Ambiguous characters count as narrow, and combining marks belong to their grapheme.
    return 1
}

/**
 * How many columns the text takes in a monospaced font: 2 for a Chinese character or an emoji (with its
 * skin tone, joined family or flag), 1 for anything else, per grapheme.
 */
export function displayWidth(text: string): number {
    if (PLAIN_ASCII.test(text)) return text.length
    let width = 0
    for (const { segment } of GRAPHEMES.segment(text)) width += graphemeWidth(segment)
    return width
}

// --- Reading ---

/** A cell as written: its text without the spaces round it, and the column that text starts at. */
type ReadCell = { text: string; start: number }

/** A row as written: its indent, its cells, and where the pipes between cells are. */
type ReadRow = { indent: string; cells: ReadCell[]; separators: number[] }

const DELIMITER_CELL = /^:?-+:?$/
// A quick look before reading a delimiter row properly.
const DELIMITER_CHARS = /^[\s|:-]+$/

/** Strips spaces and tabs only, as GFM does: any other character is part of the cell. */
function trimCell(raw: string, start: number): ReadCell {
    const lead = /^[ \t]*/.exec(raw)![0].length
    const text = raw.slice(lead).replace(/[ \t]+$/, '')
    return { text, start: start + lead }
}

/**
 * Splits a row at its pipes. A backslash escapes the character after it, so `\|` stays in its cell, as
 * it does in the preview (micromark). A pipe in backticks still splits the cell, as in GFM. The leading
 * and trailing pipes are optional.
 */
function readRow(line: string): ReadRow {
    const indent = /^[ \t]*/.exec(line)![0]
    const end = line.replace(/[ \t]+$/, '').length
    const pipes: number[] = []
    for (let index = indent.length; index < end; index += 1) {
        if (line[index] === '\\') index += 1
        else if (line[index] === '|') pipes.push(index)
    }
    const leading = pipes[0] === indent.length
    const trailing = pipes.length > (leading ? 1 : 0) && pipes[pipes.length - 1] === end - 1
    const separators = pipes.slice(leading ? 1 : 0, trailing ? -1 : undefined)
    const bounds = [leading ? indent.length + 1 : indent.length, ...separators.map((pipe) => pipe + 1)]
    const cells = bounds.map((from, index) => {
        const to = index < separators.length ? separators[index] : trailing ? end - 1 : end
        return trimCell(line.slice(from, to), from)
    })
    return { indent, cells, separators }
}

function readAlignment(cell: string): ColumnAlignment {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none'
}

/** Whether the line under a header is its delimiter row: a run of dashes per header cell, with colons for the alignment. */
function isDelimiterFor(header: string, delimiter: string): boolean {
    if (!DELIMITER_CHARS.test(delimiter)) return false
    const cells = readRow(delimiter).cells
    return cells.length === readRow(header).cells.length && cells.every((cell) => DELIMITER_CELL.test(cell.text))
}

/** The table's lines as written: from its header to its last row. */
type FoundTable = { start: number; lines: string[] }

/**
 * The table the line is in, or null. Lines with a `|` in them run together into a block, which a line
 * without one (or a blank line) ends. The table starts at the first line in the block with a delimiter
 * row under it and runs to the end of the block. Reads only the block's lines and the line each side.
 */
function findTable(lineAt: (index: number) => string, lineCount: number, lineIndex: number): FoundTable | null {
    if (lineIndex < 0 || lineIndex >= lineCount) return null
    const here = lineAt(lineIndex)
    if (!here.includes('|')) return null

    const above: string[] = []
    let first = lineIndex
    while (first > 0) {
        const line = lineAt(first - 1)
        if (!line.includes('|')) break
        above.push(line)
        first -= 1
    }
    const below: string[] = []
    for (let next = lineIndex + 1; next < lineCount; next += 1) {
        const line = lineAt(next)
        if (!line.includes('|')) break
        below.push(line)
    }
    const block = [...above.reverse(), here, ...below]

    for (let header = 0; header + 1 < block.length && first + header <= lineIndex; header += 1) {
        if (isDelimiterFor(block[header], block[header + 1])) return { start: first + header, lines: block.slice(header) }
    }
    return null
}

/**
 * Whether the line is in a table. Cheap enough to run on every caret move: a line without a `|` is the
 * only line it reads. It doesn't look for code blocks, which means reading from the top of the file;
 * the commands do that when they run.
 */
export function isLineInTable(lineAt: (index: number) => string, lineCount: number, lineIndex: number): boolean {
    return findTable(lineAt, lineCount, lineIndex) !== null
}

// --- The table ---

/** A table as cells. Every row has a cell for each column; a body row may have more after them. */
type Table = { indent: string; alignments: ColumnAlignment[]; header: string[]; body: string[][] }

/** A cell in the table: row 0 is the header, 1 the delimiter row and 2 on the body. `offset` is how far into the cell's text. */
type CellCaret = { row: number; cell: number; offset: number }

function toTable(found: FoundTable): Table {
    const [header, delimiter, ...body] = found.lines.map(readRow)
    const alignments = delimiter.cells.map((cell) => readAlignment(cell.text))
    const columns = alignments.length
    return {
        indent: header.indent,
        alignments,
        header: header.cells.map((cell) => cell.text),
        body: body.map((row) => {
            const cells = row.cells.map((cell) => cell.text)
            while (cells.length < columns) cells.push('')
            return cells
        }),
    }
}

/** The cell the caret is in: the one between the pipes either side of it. A caret on a pipe is in the cell before. */
function caretCell(found: FoundTable, caret: TextCaret): CellCaret {
    const row = caret.line - found.start
    const read = readRow(found.lines[row])
    const cell = Math.min(read.separators.filter((pipe) => pipe < caret.column).length, read.cells.length - 1)
    const { text, start } = read.cells[cell]
    return { row, cell, offset: Math.max(0, Math.min(caret.column - start, text.length)) }
}

// --- Writing ---

function padCell(text: string, width: number, alignment: ColumnAlignment): { text: string; lead: number } {
    const gap = width - displayWidth(text)
    if (alignment === 'right') return { text: ' '.repeat(gap) + text, lead: gap }
    if (alignment === 'center') {
        // The odd space goes on the right, as Prettier does.
        const lead = Math.floor(gap / 2)
        return { text: ' '.repeat(lead) + text + ' '.repeat(gap - lead), lead }
    }
    return { text: text + ' '.repeat(gap), lead: 0 }
}

function delimiterCell(width: number, alignment: ColumnAlignment): string {
    if (alignment === 'left') return `:${'-'.repeat(width - 1)}`
    if (alignment === 'right') return `${'-'.repeat(width - 1)}:`
    if (alignment === 'center') return `:${'-'.repeat(width - 2)}:`
    return '-'.repeat(width)
}

/** A cell as written: the text with its padding, how much padding comes first, and how long the text is. */
type WrittenCell = { text: string; lead: number; length: number }

/** The table in the one tidy layout, and where a cell's text starts in it. */
function writeTable(table: Table): { lines: string[]; caretAt: (caret: CellCaret) => number } {
    const columns = table.alignments.length
    // A loop, not Math.max(...), which runs out of stack on a table of many thousand rows.
    const widths = table.alignments.map((_, column) => {
        let width = Math.max(MIN_WIDTH, displayWidth(table.header[column]))
        for (const row of table.body) width = Math.max(width, displayWidth(row[column]))
        return width
    })
    const writeRow = (cells: string[]): WrittenCell[] => {
        let count = cells.length
        // Empty cells after the last column aren't text, so they go.
        while (count > columns && cells[count - 1] === '') count -= 1
        return cells.slice(0, count).map((text, column) => {
            if (column >= columns) return { text, lead: 0, length: text.length }
            return { ...padCell(text, widths[column], table.alignments[column]), length: text.length }
        })
    }
    const delimiter = table.alignments.map((alignment, column): WrittenCell => {
        const text = delimiterCell(widths[column], alignment)
        return { text, lead: 0, length: text.length }
    })
    const rows = [writeRow(table.header), delimiter, ...table.body.map(writeRow)]
    const lines = rows.map((cells) => `${table.indent}| ${cells.map((cell) => cell.text).join(' | ')} |`)

    const caretAt = ({ row, cell, offset }: CellCaret) => {
        const cells = rows[row]
        const index = Math.min(cell, cells.length - 1)
        let column = table.indent.length + 2
        for (let before = 0; before < index; before += 1) column += cells[before].text.length + 3
        return column + cells[index].lead + Math.min(offset, cells[index].length)
    }
    return { lines, caretAt }
}

/** Only the lines that differ, or null when none do. */
function changedLines(start: number, before: string[], after: string[]): LinesEdit | null {
    let head = 0
    while (head < before.length && head < after.length && before[head] === after[head]) head += 1
    if (head === before.length && head === after.length) return null
    let tail = 0
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
        tail += 1
    }
    return { start: start + head, end: start + before.length - tail, lines: after.slice(head, after.length - tail) }
}

// --- Commands ---

const ALIGN: Partial<Record<TableAction, ColumnAlignment>> = {
    'align-left': 'left',
    'align-center': 'center',
    'align-right': 'right',
    'align-none': 'none',
}

function swap<T>(items: T[], a: number, b: number): void {
    ;[items[a], items[b]] = [items[b], items[a]]
}

/** Each row of the table, the header first, so a column change reaches them all. */
function eachRow(table: Table): string[][] {
    return [table.header, ...table.body]
}

/**
 * The table after a row command, and the caret's cell in it, or null when the command can't apply.
 * The header and the delimiter row count as one row here: neither can be deleted or moved.
 */
function changeRows(table: Table, caret: CellCaret, action: TableAction): { table: Table; caret: CellCaret } | null {
    const columns = table.alignments.length
    const empty = () => Array.from({ length: columns }, () => '')
    const body = table.body.map((row) => [...row])
    const inHeader = caret.row < 2
    const index = caret.row - 2
    switch (action) {
        case 'insert-row-above':
            // Above the header, the new row is the header and the old one the first body row.
            if (inHeader) {
                body.unshift(table.header)
                return { table: { ...table, header: empty(), body }, caret: caret.row === 0 ? { ...caret, row: 2 } : caret }
            }
            body.splice(index, 0, empty())
            return { table: { ...table, body }, caret: { ...caret, row: caret.row + 1 } }
        case 'insert-row-below':
            body.splice(inHeader ? 0 : index + 1, 0, empty())
            return { table: { ...table, body }, caret }
        case 'delete-row': {
            if (inHeader) return null
            body.splice(index, 1)
            // The row that took its place, or the one above; the header once no body rows are left.
            const row = body.length === 0 ? 0 : 2 + Math.min(index, body.length - 1)
            return { table: { ...table, body }, caret: { row, cell: caret.cell, offset: 0 } }
        }
        case 'move-row-up':
            if (inHeader || index === 0) return null
            swap(body, index, index - 1)
            return { table: { ...table, body }, caret: { ...caret, row: caret.row - 1 } }
        case 'move-row-down':
            if (inHeader || index === body.length - 1) return null
            swap(body, index, index + 1)
            return { table: { ...table, body }, caret: { ...caret, row: caret.row + 1 } }
        default:
            return null
    }
}

/** The table after a column or alignment command, and the caret's cell in it, or null when the command can't apply. */
function changeColumns(table: Table, caret: CellCaret, action: TableAction): { table: Table; caret: CellCaret } | null {
    const columns = table.alignments.length
    const column = caret.cell
    // An extra cell after the last column isn't in a column.
    if (column >= columns) return null
    const alignments = [...table.alignments]
    const [header, ...body] = eachRow(table).map((row) => [...row])
    const rows = [header, ...body]
    const result = (cell: number, offset = caret.offset) => ({ table: { ...table, alignments, header, body }, caret: { ...caret, cell, offset } })

    const alignment = ALIGN[action]
    if (alignment) {
        alignments[column] = alignment
        return result(column)
    }
    switch (action) {
        case 'insert-column-left':
        case 'insert-column-right': {
            const at = action === 'insert-column-left' ? column : column + 1
            alignments.splice(at, 0, 'none')
            for (const row of rows) row.splice(at, 0, '')
            return result(action === 'insert-column-left' ? column + 1 : column)
        }
        case 'delete-column':
            if (columns === 1) return null
            alignments.splice(column, 1)
            for (const row of rows) row.splice(column, 1)
            // The column that took its place, or the one before.
            return result(Math.min(column, columns - 2), 0)
        case 'move-column-left':
        case 'move-column-right': {
            const to = action === 'move-column-left' ? column - 1 : column + 1
            if (to < 0 || to >= columns) return null
            swap(alignments, column, to)
            for (const row of rows) swap(row, column, to)
            return result(to)
        }
        default:
            return null
    }
}

const ROW_ACTIONS: ReadonlySet<TableAction> = new Set(['insert-row-above', 'insert-row-below', 'delete-row', 'move-row-up', 'move-row-down'])

function change(table: Table, caret: CellCaret, action: TableAction): { table: Table; caret: CellCaret } | null {
    if (action === 'format') return { table, caret }
    return ROW_ACTIONS.has(action) ? changeRows(table, caret, action) : changeColumns(table, caret, action)
}

/**
 * Runs a table command at the caret: finds the table there, changes it, and writes it in the tidy
 * layout. The caret stays in its cell, or goes with the cell as it moves. Nothing changes outside a
 * table, in a table inside a code block, or when the command can't apply.
 */
export function editTable(lineAt: (index: number) => string, lineCount: number, caret: TextCaret, action: TableAction): TableEditResult {
    const found = findTable(lineAt, lineCount, caret.line)
    if (!found) return { status: 'no-table' }
    if (insideCodeBlock(lineAt, found.start)) return { status: 'code-block' }

    const changed = change(toTable(found), caretCell(found, caret), action)
    if (!changed) return { status: 'unchanged' }
    const written = writeTable(changed.table)
    const edit = changedLines(found.start, found.lines, written.lines)
    if (!edit) return { status: 'unchanged' }
    return { status: 'edited', edit, caret: { line: found.start + changed.caret.row, column: written.caretAt(changed.caret) } }
}

/** What Insert Table does, or why it can't. */
export type InsertTableResult = { status: 'edited'; edit: LinesEdit; caret: TextCaret } | { status: 'in-table' } | { status: 'code-block' }

const isBlank = (line: string) => line.trim() === ''

/**
 * Inserts an empty table with a header row, a delimiter row and `size.rows` body rows, on lines of its
 * own: on the caret's line when that is blank, otherwise after it (never splitting it), with a blank
 * line each side unless one is there already or it's the start or end of the file. The caret goes in
 * the first header cell. A table after a line of text takes that line's indent, so it stays in a list item.
 */
export function insertTable(lineAt: (index: number) => string, lineCount: number, caret: TextCaret, size: TableSize): InsertTableResult {
    if (findTable(lineAt, lineCount, caret.line)) return { status: 'in-table' }
    const line = lineAt(caret.line)
    const onLine = isBlank(line)
    // The table starts on the caret's line, or the one after.
    if (insideCodeBlock(lineAt, onLine ? caret.line : caret.line + 1)) return { status: 'code-block' }

    const columns = Math.min(TABLE_COLUMNS.max, Math.max(TABLE_COLUMNS.min, Math.floor(size.columns)))
    const rows = Math.min(TABLE_ROWS.max, Math.max(TABLE_ROWS.min, Math.floor(size.rows)))
    const empty = () => Array.from({ length: columns }, () => '')
    const table: Table = {
        indent: onLine ? '' : /^[ \t]*/.exec(line)![0],
        alignments: empty().map(() => 'none'),
        header: empty(),
        body: Array.from({ length: rows }, empty),
    }
    const written = writeTable(table)

    const blankBefore = onLine ? caret.line > 0 && !isBlank(lineAt(caret.line - 1)) : true
    const blankAfter = caret.line + 1 < lineCount && !isBlank(lineAt(caret.line + 1))
    const before = onLine ? [] : [line]
    const lines = [...before, ...(blankBefore ? [''] : []), ...written.lines, ...(blankAfter ? [''] : [])]
    const headerLine = caret.line + before.length + (blankBefore ? 1 : 0)
    const edit = changedLines(caret.line, [line], lines)!
    return { status: 'edited', edit, caret: { line: headerLine, column: written.caretAt({ row: 0, cell: 0, offset: 0 }) } }
}
