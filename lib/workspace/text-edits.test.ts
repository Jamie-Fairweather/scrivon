import { describe, expect, it } from 'vitest'
import { applyTextEdits, rangeOfOffsets, wholeTextRange, type TextRange } from './text-edits'

const range = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): TextRange => ({
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
})

describe('applyTextEdits', () => {
    it('replaces, inserts and deletes, each range read in the text as it was', () => {
        const text = 'one two\nthree four'
        expect(
            applyTextEdits(text, [
                { range: range(2, 7, 2, 11), text: 'five' },
                { range: range(1, 1, 1, 4), text: '1' },
                { range: range(1, 8, 1, 8), text: '!' },
                { range: range(2, 1, 2, 7), text: '' },
            ])
        ).toBe('1 two!\nfive')
    })

    it('counts \\r\\n, \\r and \\n as one line break each, and keeps them', () => {
        const text = 'a\r\nb\rc\nd'
        expect(applyTextEdits(text, [{ range: range(4, 1, 4, 2), text: 'D' }])).toBe('a\r\nb\rc\nD')
        expect(applyTextEdits(text, [{ range: range(1, 2, 2, 1), text: '-' }])).toBe('a-b\rc\nd')
    })

    it('moves a range past the end inside the text, as Monaco does', () => {
        expect(applyTextEdits('ab\ncd', [{ range: range(1, 9, 9, 9), text: '!' }])).toBe('ab!')
        expect(applyTextEdits('ab', [{ range: range(0, 0, 1, 1), text: '>' }])).toBe('>ab')
    })

    it('refuses edits that overlap', () => {
        expect(() =>
            applyTextEdits('abcdef', [
                { range: range(1, 1, 1, 4), text: 'x' },
                { range: range(1, 3, 1, 5), text: 'y' },
            ])
        ).toThrow('overlap')
    })

    it('makes no change for no edits', () => {
        expect(applyTextEdits('same\r\n', [])).toBe('same\r\n')
    })
})

describe('wholeTextRange', () => {
    it('covers all of the text, so one edit can replace it', () => {
        for (const text of ['', 'one line', 'a\nb\n', 'a\r\nlast line', '\r\r']) {
            expect(applyTextEdits(text, [{ range: wholeTextRange(text), text: 'new' }])).toBe('new')
        }
        expect(wholeTextRange('a\r\nlast line')).toEqual(range(1, 1, 2, 10))
    })
})

describe('rangeOfOffsets', () => {
    it('turns offsets into lines and columns', () => {
        const text = 'ab\r\ncd\nef'
        expect(rangeOfOffsets(text, 0, 2)).toEqual(range(1, 1, 1, 3))
        expect(rangeOfOffsets(text, 4, 8)).toEqual(range(2, 1, 3, 2))
        expect(rangeOfOffsets(text, 9, 99)).toEqual(range(3, 3, 3, 3))
        // Inside a \r\n is the end of its line.
        expect(rangeOfOffsets(text, 3, 3)).toEqual(range(1, 3, 1, 3))
        expect(applyTextEdits(text, [{ range: rangeOfOffsets(text, 1, 5), text: '_' }])).toBe('a_d\nef')
    })
})
