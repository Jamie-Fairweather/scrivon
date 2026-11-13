import { describe, expect, it } from 'vitest'
import { goToLineHint, goToLineItem, headingItems, helpItems } from '@/components/studio/command-palette/palette-prefixes'
import type { OutlineHeading } from '@/lib/markdown/document-outline'

const notes = { path: '/ws/notes.md', name: 'notes.md', content: ['# Notes', '', 'Some text here', 'last'].join('\n') }

describe('goToLineItem', () => {
    it('goes to the line typed', () => {
        expect(goToLineItem(notes, '3')).toMatchObject({ kind: 'line', path: '/ws/notes.md', line: 3, column: 1, label: 'Go to line 3' })
    })

    it.each(['3:6', '3,6', '3 : 6'])('goes to a column too (%s)', (query) => {
        expect(goToLineItem(notes, query)).toMatchObject({ line: 3, column: 6, label: 'Go to line 3, column 6' })
    })

    it('waits for the column while only the colon after the line is typed', () => {
        expect(goToLineItem(notes, '3:')).toMatchObject({ line: 3, column: 1, label: 'Go to line 3' })
    })

    it('names the file and how many lines it has', () => {
        expect(goToLineItem(notes, '2')?.detail).toBe('notes.md · 4 lines')
        expect(goToLineItem({ ...notes, content: 'one' }, '1')?.detail).toBe('notes.md · 1 line')
    })

    it('stops at the last line, and says so', () => {
        expect(goToLineItem(notes, '120')).toMatchObject({ line: 4, column: 1, label: 'Go to line 4, the last line' })
    })

    it('stops at the end of the line', () => {
        expect(goToLineItem(notes, '4:99')).toMatchObject({ line: 4, column: 5, label: 'Go to line 4, column 5' })
    })

    it('counts lines in a file saved with Windows line endings without the hidden return', () => {
        const windows = { ...notes, content: 'ab\r\ncd\r\n' }
        expect(goToLineItem(windows, '1:9')).toMatchObject({ line: 1, column: 3 })
        expect(goToLineItem(windows, '9')).toMatchObject({ line: 3 })
    })

    it('treats line 0 as the first line', () => {
        expect(goToLineItem(notes, '0:0')).toMatchObject({ line: 1, column: 1 })
    })

    it.each(['', 'abc', '3:x', '-2', '1.5'])('offers nothing until a line number is typed (%j)', (query) => {
        expect(goToLineItem(notes, query)).toBeNull()
    })
})

describe('headingItems', () => {
    const heading = (level: number, text: string, line: number): OutlineHeading => ({ id: text.toLowerCase(), level, text, line })
    const guide = [heading(2, 'Install', 3), heading(3, 'Windows', 5), heading(3, 'Mac', 9), heading(2, 'Use the app', 12)]

    it('lists every heading in file order, set in by level from the top level the file uses', () => {
        const items = headingItems(guide, '/ws/guide.md', '')
        expect(items.map((item) => [item.text, item.depth, item.line])).toEqual([
            ['Install', 0, 3],
            ['Windows', 1, 5],
            ['Mac', 1, 9],
            ['Use the app', 0, 12],
        ])
        expect(items[1]).toMatchObject({ kind: 'heading', path: '/ws/guide.md', headingId: 'windows' })
    })

    it('puts the best match first while typing, without setting rows in', () => {
        const items = headingItems(guide, '/ws/guide.md', 'use')
        expect(items.map((item) => [item.text, item.depth])).toEqual([['Use the app', 0]])
    })

    it('gives two headings with the same text their own rows', () => {
        const items = headingItems([heading(2, 'Notes', 1), heading(2, 'Notes', 8)], '/ws/a.md', '')
        expect(new Set(items.map((item) => item.value)).size).toBe(2)
    })
})

describe('helpItems', () => {
    it('lists the prefixes the palette understands', () => {
        expect(helpItems('').map((item) => [item.prefix, item.label])).toEqual([
            ['>', 'Run a command'],
            [':', 'Go to a line in the open file'],
            ['@', 'Jump to a heading in the open Markdown file'],
        ])
    })

    it.each([
        ['heading', '@'],
        ['LINE', ':'],
        ['>', '>'],
    ])('finds a prefix by what it does or by the prefix itself (%s)', (query, prefix) => {
        expect(helpItems(query).map((item) => item.prefix)).toEqual([prefix])
    })

    it('lists nothing when nothing matches', () => {
        expect(helpItems('zzz')).toEqual([])
    })
})

describe('goToLineHint', () => {
    it('asks for a line number in the range of the file', () => {
        expect(goToLineHint(notes)).toBe('Type a line number from 1 to 4. Add :5 to go to a column.')
    })

    it('asks for a file when none is open', () => {
        expect(goToLineHint(null)).toBe('Open a file to go to a line in it.')
    })
})
