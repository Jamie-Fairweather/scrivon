import { describe, expect, it } from 'vitest'
import {
    displayWidth,
    editTable,
    insertTable,
    isLineInTable,
    type LinesEdit,
    type TableAction,
    type TableSize,
    type TextCaret,
} from '@/lib/markdown/markdown-table'

/** Applies an edit to lines of text. */
function applied(lines: string[], edit: LinesEdit): string[] {
    return [...lines.slice(0, edit.start), ...edit.lines, ...lines.slice(edit.end)]
}

/** Text with the caret written as `¦` (a pipe would be part of the table): the lines without it, and where it was. */
function withCaret(text: string): { lines: string[]; caret: TextCaret } {
    const lines = text.split('\n')
    const line = lines.findIndex((l) => l.includes('¦'))
    if (line === -1) throw new Error('No caret (¦) in the text')
    const column = lines[line].indexOf('¦')
    lines[line] = lines[line].replace('¦', '')
    return { lines, caret: { line, column } }
}

function showCaret(lines: string[], caret: TextCaret): string {
    const shown = [...lines]
    shown[caret.line] = `${shown[caret.line].slice(0, caret.column)}¦${shown[caret.line].slice(caret.column)}`
    return shown.join('\n')
}

/** Runs the command on the text with its caret, and shows the text after it with the new caret, or the status when nothing changed. */
function run(text: string, action: TableAction): string {
    const { lines, caret } = withCaret(text)
    const result = editTable((index) => lines[index], lines.length, caret, action)
    if (result.status !== 'edited') return result.status
    return showCaret(applied(lines, result.edit), result.caret)
}

function insert(text: string, size: TableSize = { columns: 3, rows: 2 }): string {
    const { lines, caret } = withCaret(text)
    const result = insertTable((index) => lines[index], lines.length, caret, size)
    if (result.status !== 'edited') return result.status
    return showCaret(applied(lines, result.edit), result.caret)
}

const join = (...lines: string[]) => lines.join('\n')

describe('displayWidth', () => {
    it('counts wide characters and emoji as 2, per grapheme', () => {
        expect(displayWidth('中')).toBe(2)
        expect(displayWidth('中文')).toBe(4)
        expect(displayWidth('😀')).toBe(2)
        expect(displayWidth('❤️')).toBe(2)
        expect(displayWidth('👍🏽')).toBe(2)
        expect(displayWidth('👨‍👩‍👧')).toBe(2)
        expect(displayWidth('🇬🇧')).toBe(2)
        expect(displayWidth('ｱ')).toBe(1)
        expect(displayWidth('Ａ')).toBe(2)
    })

    it('counts other characters as 1, with combining marks in their grapheme', () => {
        expect(displayWidth('abc')).toBe(3)
        expect(displayWidth('e\u0301')).toBe(1)
        expect(displayWidth('©')).toBe(1)
        // Ambiguous width (Greek, the section sign) is narrow.
        expect(displayWidth('α§')).toBe(2)
        expect(displayWidth('')).toBe(0)
    })
})

describe('Format Table', () => {
    it('lines the pipes up, with each alignment padded its own way', () => {
        expect(run(join('|a¦|bb|', '|:-:|-:|', '|中文|x|'), 'format')).toBe(join('|  a¦   |  bb |', '| :--: | --: |', '| 中文 |   x |'))
    })

    it('pads left and none columns on the right, and keeps each column at least 3 wide', () => {
        expect(run(join('¦a|b', ':-|-', '1|2'), 'format')).toBe(join('| ¦a   | b   |', '| :-- | --- |', '| 1   | 2   |'))
    })

    it('puts the odd space of a centred cell on the right', () => {
        expect(run(join('|¦abcd|', '|:-:|', '|a|'), 'format')).toBe(join('| ¦abcd |', '| :--: |', '|  a   |'))
    })

    it('gives a short row empty cells', () => {
        expect(run(join('| a | b |', '|---|---|', '| ¦1 |'), 'format')).toBe(join('| a   | b   |', '| --- | --- |', '| ¦1   |     |'))
    })

    it('keeps extra cells after the last column', () => {
        expect(run(join('| a | b |', '|---|---|', '| ¦1 | 2 | 3 | four |'), 'format')).toBe(
            join('| a   | b   |', '| --- | --- |', '| ¦1   | 2   | 3 | four |')
        )
    })

    it('makes no edit to a tidy table', () => {
        const tidy = join('| a   |  b  |   c |', '| :-- | :-: | --: |', '| 1¦   |  2  |   3 |')
        expect(run(tidy, 'format')).toBe('unchanged')
        const formatted = run(join('|a¦|b|', '|:-:|-|', '|中文😀|x \\| y|', '|1|'), 'format')
        expect(run(formatted, 'format')).toBe('unchanged')
    })

    it('writes leading and trailing pipes when the table has none', () => {
        expect(run(join('a | b¦', '--- | ---', '1 | 2'), 'format')).toBe(join('| a   | b¦   |', '| --- | --- |', '| 1   | 2   |'))
    })

    it('sizes columns by width on screen', () => {
        const acute = 'e\u0301'
        expect(run(join('|x¦|y|', '|-|-|', '|❤️|👨‍👩‍👧👍🏽|', `|${acute}|©|`, '|🇬🇧|中|'), 'format')).toBe(
            join('| x¦   | y    |', '| --- | ---- |', '| ❤️  | 👨‍👩‍👧👍🏽 |', `| ${acute}   | ©    |`, '| 🇬🇧  | 中   |')
        )
    })

    it('keeps escaped pipes and backslashes in their cell, exactly as written', () => {
        expect(run(join('|a¦|b|', '|-|-|', String.raw`|x \| y|\\|`, String.raw`|c:\path|${'`'}a|b${'`'}|`), 'format')).toBe(
            join('| a¦       | b   |', '| ------- | --- |', String.raw`| x \| y  | \\  |`, String.raw`| c:\path | ${'`'}a  | b${'`'} |`)
        )
    })

    it('splits a row at a pipe after an escaped backslash, as the preview does', () => {
        expect(run(join('|a¦|b|', '|-|-|', String.raw`|x\\|y|`), 'format')).toBe(join('| a¦   | b   |', '| --- | --- |', String.raw`| x\\ | y   |`))
    })

    it('keeps the indent of a table in a list item', () => {
        expect(run(join('- item', '', '  |a¦|b|', '  |-|-|', '  |1|2|'), 'format')).toBe(
            join('- item', '', '  | a¦   | b   |', '  | --- | --- |', '  | 1   | 2   |')
        )
    })

    it('ends the table at a blank line or a line without a pipe', () => {
        expect(run(join('|a¦|b|', '|-|-|', '|1|2|', 'text', '|3|4|'), 'format')).toBe(
            join('| a¦   | b   |', '| --- | --- |', '| 1   | 2   |', 'text', '|3|4|')
        )
        expect(run(join('|a¦|b|', '|-|-|', '', '|3|4|'), 'format')).toBe(join('| a¦   | b   |', '| --- | --- |', '', '|3|4|'))
    })

    it('changes only the lines that differ', () => {
        const { lines, caret } = withCaret(join('intro', '| a   | b   |', '| --- | --- |', '| 1¦ | 2 |', 'outro'))
        const result = editTable((index) => lines[index], lines.length, caret, 'format')
        expect(result).toEqual({ status: 'edited', edit: { start: 3, end: 4, lines: ['| 1   | 2   |'] }, caret: { line: 3, column: 3 } })
    })

    it('changes nothing without a delimiter row matching the header', () => {
        expect(run(join('|a¦|b|', '|c|d|'), 'format')).toBe('no-table')
        expect(run(join('|a¦|b|', '|-|-|-|', '|1|2|'), 'format')).toBe('no-table')
        expect(run(join('|a¦|b|', '|-|x|'), 'format')).toBe('no-table')
        expect(run(join('a ¦b', '---'), 'format')).toBe('no-table')
    })

    it('finds the table from any of its rows, the delimiter row too', () => {
        expect(run(join('|a|b|', '|-¦|-|', '|1|2|'), 'format')).toBe(join('| a   | b   |', '| -¦-- | --- |', '| 1   | 2   |'))
        expect(run(join('|a|b|', '|-|-|', '|1|2¦|'), 'format')).toBe(join('| a   | b   |', '| --- | --- |', '| 1   | 2¦   |'))
    })

    it('starts the table at its header, leaving lines with pipes above it alone', () => {
        expect(run(join('a | b | c', '|x¦|y|', '|-|-|'), 'format')).toBe(join('a | b | c', '| x¦   | y   |', '| --- | --- |'))
        expect(run(join('a ¦| b | c', '|x|y|', '|-|-|'), 'format')).toBe('no-table')
    })

    it('leaves a table inside a code block alone', () => {
        expect(run(join('```', '|a¦|b|', '|-|-|', '```'), 'format')).toBe('code-block')
        expect(run(join('~~~md', '|a¦|b|', '|-|-|'), 'format')).toBe('code-block')
        expect(run(join('```', 'code', '```', '|a¦|b|', '|-|-|'), 'format')).not.toBe('code-block')
    })

    it('keeps the caret in its cell, at the same place in its text', () => {
        expect(run(join('|  hel¦lo|b|', '|-|-|'), 'format')).toBe(join('| hel¦lo | b   |', '| ----- | --- |'))
        // From the padding, to the nearer end of the text.
        expect(run(join('| a   ¦  |b|', '|-|-|'), 'format')).toBe(join('| a¦   | b   |', '| --- | --- |'))
        expect(run(join('¦| a |b|', '|-|-|'), 'format')).toBe(join('| ¦a   | b   |', '| --- | --- |'))
        // After the trailing pipe, in the last cell.
        expect(run(join('| a | b |¦', '|-|-|'), 'format')).toBe(join('| a   | b¦   |', '| --- | --- |'))
    })
})

describe('Align Column', () => {
    const table = join('| a   | b¦   |', '| --- | --- |', '| 1   | 2   |')

    it.each<[TableAction, string]>([
        ['align-left', '| :-- |'],
        ['align-center', '| :-: |'],
        ['align-right', '| --: |'],
    ])('%s changes only that column’s delimiter, and formats the table', (action, delimiter) => {
        const after = run(table, action).split('\n')
        expect(after[1]).toBe(`| --- ${delimiter}`)
        expect(after[0].startsWith('| a   |')).toBe(true)
    })

    it('right-aligns the column’s cells and keeps the caret in its cell', () => {
        expect(run(table, 'align-right')).toBe(join('| a   |   b¦ |', '| --- | --: |', '| 1   |   2 |'))
    })

    it('takes the alignment off with None', () => {
        expect(run(join('| a   |   b¦ |', '| --- | --: |'), 'align-none')).toBe(join('| a   | b¦   |', '| --- | --- |'))
    })

    it('makes no edit when the column already has that alignment', () => {
        expect(run(table, 'align-none')).toBe('unchanged')
    })

    it('works from the delimiter row', () => {
        expect(run(join('| a   | b   |', '| --- | -¦-- |'), 'align-center')).toBe(join('| a   |  b  |', '| --- | :¦-: |'))
    })

    it('keeps the alignment when the table is formatted again', () => {
        const aligned = run(table, 'align-center')
        expect(run(aligned, 'format')).toBe('unchanged')
    })
})

describe('row commands', () => {
    const table = join('| h1  | h2  |', '| --- | --- |', '| a   | b   |', '| c   | d   |')
    const at = (row: number, text: string) =>
        table
            .split('\n')
            .map((line, index) => (index === row ? line.replace(text, `${text}¦`) : line))
            .join('\n')

    it('inserts a row above or below, keeping the caret in its cell', () => {
        expect(run(at(3, 'c'), 'insert-row-above')).toBe(join('| h1  | h2  |', '| --- | --- |', '| a   | b   |', '|     |     |', '| c¦   | d   |'))
        expect(run(at(2, 'a'), 'insert-row-below')).toBe(join('| h1  | h2  |', '| --- | --- |', '| a¦   | b   |', '|     |     |', '| c   | d   |'))
    })

    it('inserts the first body row from the header or delimiter row', () => {
        expect(run(at(0, 'h2'), 'insert-row-below')).toBe(join('| h1  | h2¦  |', '| --- | --- |', '|     |     |', '| a   | b   |', '| c   | d   |'))
        expect(run(join('| h1  | h2  |', '| -¦-- | --- |'), 'insert-row-below')).toBe(join('| h1  | h2  |', '| -¦-- | --- |', '|     |     |'))
    })

    it('inserts a new header above the header, which becomes the first body row', () => {
        expect(run(at(0, 'h1'), 'insert-row-above')).toBe(join('|     |     |', '| --- | --- |', '| h1¦  | h2  |', '| a   | b   |', '| c   | d   |'))
    })

    it('deletes a row, putting the caret in the row that took its place, or the one above', () => {
        expect(run(at(2, 'b'), 'delete-row')).toBe(join('| h1  | h2  |', '| --- | --- |', '| c   | ¦d   |'))
        expect(run(at(3, 'd'), 'delete-row')).toBe(join('| h1  | h2  |', '| --- | --- |', '| a   | ¦b   |'))
    })

    it('deletes the last body row, leaving a header-only table', () => {
        expect(run(join('| h1  | h2  |', '| --- | --- |', '| a¦   | b   |'), 'delete-row')).toBe(join('| ¦h1  | h2  |', '| --- | --- |'))
    })

    it('moves a row up or down, with the caret', () => {
        expect(run(at(3, 'c'), 'move-row-up')).toBe(join('| h1  | h2  |', '| --- | --- |', '| c¦   | d   |', '| a   | b   |'))
        expect(run(at(2, 'b'), 'move-row-down')).toBe(join('| h1  | h2  |', '| --- | --- |', '| c   | d   |', '| a   | b¦   |'))
    })

    it('makes no edit to delete or move the header row, or to move past either end', () => {
        expect(run(at(0, 'h1'), 'delete-row')).toBe('unchanged')
        expect(run(at(0, 'h1'), 'move-row-up')).toBe('unchanged')
        expect(run(at(0, 'h1'), 'move-row-down')).toBe('unchanged')
        expect(run(join('| h1  | h2  |', '| -¦-- | --- |', '| a   | b   |'), 'delete-row')).toBe('unchanged')
        expect(run(at(2, 'a'), 'move-row-up')).toBe('unchanged')
        expect(run(at(3, 'c'), 'move-row-down')).toBe('unchanged')
    })

    it('formats the table as it goes', () => {
        expect(run(join('|a|b|', '|-|-|', '|1¦|2|'), 'insert-row-below')).toBe(
            join('| a   | b   |', '| --- | --- |', '| 1¦   | 2   |', '|     |     |')
        )
    })

    it('moves a long row with its extra cells', () => {
        expect(run(join('| a   | b   |', '| --- | --- |', '| 1   | 2   | x |', '| 3¦   | 4   |'), 'move-row-up')).toBe(
            join('| a   | b   |', '| --- | --- |', '| 3¦   | 4   |', '| 1   | 2   | x |')
        )
    })
})

describe('column commands', () => {
    const table = join('| a   |   b |', '| :-- | --: |', '| 1   |   2 |')
    const atB = table.replace('b |', 'b¦ |')
    const atA = table.replace('a ', 'a¦ ')

    it('inserts a column left or right, with no alignment, keeping the caret in its cell', () => {
        expect(run(atB, 'insert-column-left')).toBe(join('| a   |     |   b¦ |', '| :-- | --- | --: |', '| 1   |     |   2 |'))
        expect(run(atA, 'insert-column-right')).toBe(join('| a¦   |     |   b |', '| :-- | --- | --: |', '| 1   |     |   2 |'))
    })

    it('deletes a column, putting the caret in the one that took its place, or the one before', () => {
        expect(run(atA, 'delete-column')).toBe(join('|   ¦b |', '| --: |', '|   2 |'))
        expect(run(atB, 'delete-column')).toBe(join('| ¦a   |', '| :-- |', '| 1   |'))
    })

    it('moves a column left or right with its alignment and the caret', () => {
        expect(run(atB, 'move-column-left')).toBe(join('|   b¦ | a   |', '| --: | :-- |', '|   2 | 1   |'))
        expect(run(atA, 'move-column-right')).toBe(join('|   b | a¦   |', '| --: | :-- |', '|   2 | 1   |'))
    })

    it('makes no edit to delete the only column, or to move past either end', () => {
        expect(run(join('| a¦   |', '| --- |'), 'delete-column')).toBe('unchanged')
        expect(run(atA, 'move-column-left')).toBe('unchanged')
        expect(run(atB, 'move-column-right')).toBe('unchanged')
    })

    it('works on short rows, giving them their empty cells', () => {
        expect(run(join('| a¦   | b   |', '| --- | --- |', '| 1   |'), 'move-column-right')).toBe(
            join('| b   | a¦   |', '| --- | --- |', '|     | 1   |')
        )
    })

    it('keeps extra cells after the last column', () => {
        expect(run(join('| a¦   | b   |', '| --- | --- |', '| 1   | 2   | x |'), 'delete-column')).toBe(join('| ¦b   |', '| --- |', '| 2   | x |'))
        expect(run(join('| a¦   | b   |', '| --- | --- |', '| 1   | 2   | x |'), 'insert-column-left')).toBe(
            join('|     | a¦   | b   |', '| --- | --- | --- |', '|     | 1   | 2   | x |')
        )
    })

    it('makes no edit from an extra cell, which is in no column', () => {
        expect(run(join('| a   | b   |', '| --- | --- |', '| 1   | 2   | x¦ |'), 'delete-column')).toBe('unchanged')
    })
})

describe('every table command', () => {
    const actions: TableAction[] = [
        'insert-row-above',
        'insert-row-below',
        'delete-row',
        'move-row-up',
        'move-row-down',
        'insert-column-left',
        'insert-column-right',
        'delete-column',
        'move-column-left',
        'move-column-right',
        'align-left',
        'align-center',
        'align-right',
        'align-none',
        'format',
    ]

    it.each(actions)('%s makes no edit with the caret just outside a table', (action) => {
        expect(run(join('¦', '| a | b |', '|---|---|'), action)).toBe('no-table')
        expect(run(join('| a | b |', '|---|---|', 'text¦'), action)).toBe('no-table')
    })

    it.each(actions)('%s leaves a table in a code block alone', (action) => {
        expect(run(join('```', '| a | b |', '|---|---|', '| 1¦ | 2 |'), action)).toBe('code-block')
    })

    it.each(actions.filter((action) => !action.startsWith('delete')))('%s never loses text', (action) => {
        const { lines, caret } = withCaret(
            join(String.raw`  | a | b \| c`, '  |:-|-:|', '  | `x|y` | 中 | extra | more', '  | ¦z', String.raw`  | w \\ | q |`)
        )
        const result = editTable((index) => lines[index], lines.length, caret, action)
        const after = result.status === 'edited' ? applied(lines, result.edit) : lines
        // Everything but the pipes, the delimiter row's dashes and colons, and spaces.
        const words = (text: string) => (text.match(/[^\s|:-]+/g) ?? []).sort()
        expect(words(after.join('\n'))).toEqual(words(lines.join('\n')))
        // Still a table, in the list item's indent.
        expect(after.every((line) => line.startsWith('  |'))).toBe(true)
    })
})

describe('isLineInTable', () => {
    /** 50,000 lines with a table in the middle, counting each line read. */
    function bigFile() {
        const lines = Array.from({ length: 50_000 }, (_, index) => `Line ${index} of prose.`)
        lines.splice(25_000, 4, '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |')
        const read: number[] = []
        const lineAt = (index: number) => {
            read.push(index)
            return lines[index]
        }
        return { lines, lineAt, read }
    }

    it('reads only the caret’s line when it has no pipe', () => {
        const { lines, lineAt, read } = bigFile()
        expect(isLineInTable(lineAt, lines.length, 10_000)).toBe(false)
        expect(read).toEqual([10_000])
    })

    it('reads only the table’s lines and the line each side of it', () => {
        const { lines, lineAt, read } = bigFile()
        expect(isLineInTable(lineAt, lines.length, 25_002)).toBe(true)
        expect([...read].sort((a, b) => a - b)).toEqual([24_999, 25_000, 25_001, 25_002, 25_003, 25_004])
    })

    it('is false for lines with pipes that are not a table', () => {
        const lines = ['a | b', 'c | d']
        expect(isLineInTable((index) => lines[index], lines.length, 0)).toBe(false)
    })

    it('stops at the start and end of the file', () => {
        const lines = ['| a |', '| - |']
        const read: number[] = []
        expect(
            isLineInTable(
                (index) => {
                    read.push(index)
                    return lines[index]
                },
                lines.length,
                1
            )
        ).toBe(true)
        expect(read.sort()).toEqual([0, 1])
    })

    it('does not look for code blocks, which would read from the top', () => {
        const lines = ['```', '| a |', '| - |']
        expect(isLineInTable((index) => lines[index], lines.length, 1)).toBe(true)
    })
})

describe('Insert Table', () => {
    it('inserts a tidy table on a blank line, with the caret in the first header cell', () => {
        expect(insert('¦')).toBe(join('| ¦    |     |     |', '| --- | --- | --- |', '|     |     |     |', '|     |     |     |'))
    })

    it('goes after a line with text, never splitting it, with a blank line between', () => {
        expect(insert(join('Some ¦text', 'More'), { columns: 2, rows: 1 })).toBe(
            join('Some text', '', '| ¦    |     |', '| --- | --- |', '|     |     |', '', 'More')
        )
    })

    it('adds a blank line only where there isn’t one, or the start or end of the file', () => {
        expect(insert(join('Text', '¦', 'More'), { columns: 1, rows: 1 })).toBe(join('Text', '', '| ¦    |', '| --- |', '|     |', '', 'More'))
        expect(insert(join('Text', '', '¦', '', 'More'), { columns: 1, rows: 1 })).toBe(
            join('Text', '', '| ¦    |', '| --- |', '|     |', '', 'More')
        )
        expect(insert(join('Last¦'), { columns: 1, rows: 1 })).toBe(join('Last', '', '| ¦    |', '| --- |', '|     |'))
    })

    it('keeps the indent of a line in a list item', () => {
        expect(insert(join('- item', '  more¦'), { columns: 1, rows: 1 })).toBe(join('- item', '  more', '', '  | ¦    |', '  | --- |', '  |     |'))
    })

    it('keeps the size within 1 to 20 columns and 1 to 100 rows', () => {
        const big = insert('¦', { columns: 50, rows: 500 }).split('\n')
        expect(big).toHaveLength(102)
        expect(big[0].split('|')).toHaveLength(22)
        expect(insert('¦', { columns: 0, rows: 0 })).toBe(join('| ¦    |', '| --- |', '|     |'))
    })

    it('does nothing with the caret in a table or a code block', () => {
        expect(insert(join('| a | b |', '|---|---|', '| 1¦ | 2 |'))).toBe('in-table')
        expect(insert(join('```', '¦'))).toBe('code-block')
        // After the fence that opens a block is inside it too.
        expect(insert(join('```¦', 'code', '```'))).toBe('code-block')
        expect(insert(join('```', 'code', '```¦'))).not.toBe('code-block')
    })

    it('keeps the file’s other lines as they are', () => {
        const { lines, caret } = withCaret(join('a', 'b¦', 'c'))
        const result = insertTable((index) => lines[index], lines.length, caret, { columns: 1, rows: 1 })
        expect(result.status === 'edited' && result.edit).toEqual({ start: 2, end: 2, lines: ['', '|     |', '| --- |', '|     |', ''] })
    })
})
