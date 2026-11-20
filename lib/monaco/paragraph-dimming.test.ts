import { describe, expect, it } from 'vitest'
import { dimmedLineSpans, focusedLines, isBlankLine, type LineSelection } from './paragraph-dimming'

const TEXT = [
    '# Title', // 1
    '', // 2
    'First paragraph,', // 3
    'still the first.', // 4
    '   ', // 5 (spaces only)
    'Second paragraph.', // 6
    '', // 7
    '', // 8
    '- a list', // 9
    '- counts as one', // 10
]

const line = (n: number) => TEXT[n - 1]!

function cursor(lineNumber: number, column = 1): LineSelection {
    return { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column }
}

function selection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): LineSelection {
    return { startLineNumber, startColumn, endLineNumber, endColumn }
}

const focus = (...selections: LineSelection[]) => focusedLines(TEXT.length, line, selections)

describe('isBlankLine', () => {
    it('counts a line of spaces or tabs as blank', () => {
        expect(isBlankLine('')).toBe(true)
        expect(isBlankLine(' \t ')).toBe(true)
        expect(isBlankLine(' a ')).toBe(false)
    })
})

describe('focusedLines', () => {
    it('is the paragraph the cursor is in, between blank lines', () => {
        expect(focus(cursor(3))).toEqual({ start: 3, end: 4 })
        expect(focus(cursor(4, 8))).toEqual({ start: 3, end: 4 })
        // Spaces only still end a paragraph.
        expect(focus(cursor(6))).toEqual({ start: 6, end: 6 })
    })

    it('runs to the start and end of the file', () => {
        expect(focus(cursor(1))).toEqual({ start: 1, end: 1 })
        expect(focus(cursor(10))).toEqual({ start: 9, end: 10 })
    })

    it('treats a list like any other paragraph', () => {
        expect(focus(cursor(9))).toEqual({ start: 9, end: 10 })
    })

    it('is the blank line alone when the cursor is on one', () => {
        expect(focus(cursor(7))).toEqual({ start: 7, end: 7 })
        expect(focus(cursor(2))).toEqual({ start: 2, end: 2 })
    })

    it('keeps every paragraph a selection touches', () => {
        expect(focus(selection(4, 3, 6, 2))).toEqual({ start: 3, end: 6 })
        expect(focus(selection(1, 1, 10, 3))).toEqual({ start: 1, end: 10 })
    })

    it('leaves out the line a selection ends at the very start of', () => {
        // As selecting the first paragraph's lines whole does: the selection ends at the start of line 5.
        expect(focus(selection(3, 1, 6, 1))).toEqual({ start: 3, end: 5 })
        expect(focus(selection(3, 1, 7, 1))).toEqual({ start: 3, end: 6 })
    })

    it('spans every paragraph with a cursor in it, with multiple cursors', () => {
        expect(focus(cursor(3), cursor(9))).toEqual({ start: 3, end: 10 })
        expect(focus(cursor(9), cursor(1))).toEqual({ start: 1, end: 10 })
    })

    it('has nothing to keep with no lines or no cursor', () => {
        expect(focusedLines(0, line, [cursor(1)])).toBeNull()
        expect(focus()).toBeNull()
    })

    it('reads only the lines around the edges', () => {
        const read: number[] = []
        const long = (n: number) => {
            read.push(n)
            return n % 1000 === 0 ? '' : 'text'
        }
        expect(focusedLines(100_000, long, [cursor(50_500)])).toEqual({ start: 50_001, end: 50_999 })
        expect(read.length).toBeLessThan(1_100)
    })
})

describe('dimmedLineSpans', () => {
    it('dims everything above and below the focused lines, in at most two spans', () => {
        expect(dimmedLineSpans(10, { start: 3, end: 4 })).toEqual([
            { start: 1, end: 2 },
            { start: 5, end: 10 },
        ])
    })

    it('dims nothing above the first line or below the last', () => {
        expect(dimmedLineSpans(10, { start: 1, end: 4 })).toEqual([{ start: 5, end: 10 }])
        expect(dimmedLineSpans(10, { start: 9, end: 10 })).toEqual([{ start: 1, end: 8 }])
        expect(dimmedLineSpans(10, { start: 1, end: 10 })).toEqual([])
        expect(dimmedLineSpans(10, null)).toEqual([])
    })
})
