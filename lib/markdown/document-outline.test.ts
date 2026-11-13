import { describe, expect, it } from 'vitest'
import { headingAtLine, markdownOutline, outlineTree, sameOutline, type OutlineHeading } from '@/lib/markdown/document-outline'

describe('markdownOutline', () => {
    it('lists headings in order with their level, text, id and line', () => {
        const source = ['# Title', '', 'Some text.', '', '## Install', '', '### On Windows', '', '## Install'].join('\n')
        expect(markdownOutline(source)).toEqual([
            { id: 'title', level: 1, text: 'Title', line: 1 },
            { id: 'install', level: 2, text: 'Install', line: 5 },
            { id: 'on-windows', level: 3, text: 'On Windows', line: 7 },
            { id: 'install-1', level: 2, text: 'Install', line: 9 },
        ])
    })

    it('counts lines from the top of the file when it starts with front matter', () => {
        const source = ['---', 'title: Notes', 'author: Sam', '---', '', '# Intro', '', '## Next'].join('\r\n')
        expect(markdownOutline(source)).toEqual([
            { id: 'intro', level: 1, text: 'Intro', line: 6 },
            { id: 'next', level: 2, text: 'Next', line: 8 },
        ])
    })

    it('leaves out hashes in code and empty headings, and counts underlined headings', () => {
        const source = ['Setext title', '============', '', '```bash', '# not a heading', '```', '', '##', '', '## **Bold** `code`'].join('\n')
        expect(markdownOutline(source)).toEqual([
            { id: 'setext-title', level: 1, text: 'Setext title', line: 1 },
            { id: 'bold-code', level: 2, text: 'Bold code', line: 10 },
        ])
    })

    it('finds nothing in a document with no headings', () => {
        expect(markdownOutline('Just a paragraph.\n\n- and a list')).toEqual([])
        expect(markdownOutline('')).toEqual([])
    })
})

function heading(text: string, level: number, line: number): OutlineHeading {
    return { id: text.toLowerCase(), level, text, line }
}

describe('outlineTree', () => {
    it('nests each heading under the closest heading above it with a lower level', () => {
        const items = [heading('A', 1, 1), heading('B', 2, 3), heading('C', 4, 5), heading('D', 2, 7), heading('E', 1, 9)]
        const tree = outlineTree(items)
        const shape = (nodes: ReturnType<typeof outlineTree>): unknown[] =>
            nodes.map((node) => (node.children.length ? [node.heading.text, shape(node.children)] : node.heading.text))
        expect(shape(tree)).toEqual([['A', [['B', ['C']], 'D']], 'E'])
    })

    it('keeps headings that start below the top level at the top', () => {
        const tree = outlineTree([heading('Deep', 3, 1), heading('Top', 1, 3), heading('Mid', 2, 5)])
        expect(tree.map((node) => node.heading.text)).toEqual(['Deep', 'Top'])
        expect(tree[1]!.children.map((node) => node.heading.text)).toEqual(['Mid'])
    })

    it('numbers each node by its place in the flat list', () => {
        const tree = outlineTree([heading('A', 1, 1), heading('B', 2, 3), heading('C', 1, 5)])
        expect([tree[0]!.index, tree[0]!.children[0]!.index, tree[1]!.index]).toEqual([0, 1, 2])
    })
})

describe('headingAtLine', () => {
    const items = [heading('A', 1, 3), heading('B', 2, 10), heading('C', 2, 20)]

    it('finds the heading whose section holds the line', () => {
        expect(headingAtLine(items, 3)).toBe(0)
        expect(headingAtLine(items, 9)).toBe(0)
        expect(headingAtLine(items, 10)).toBe(1)
        expect(headingAtLine(items, 500)).toBe(2)
    })

    it('finds none above the first heading or with no line', () => {
        expect(headingAtLine(items, 1)).toBe(-1)
        expect(headingAtLine(items, null)).toBe(-1)
        expect(headingAtLine([], 4)).toBe(-1)
    })
})

describe('sameOutline', () => {
    it('is true only for the same headings on the same lines', () => {
        const items = [heading('A', 1, 1), heading('B', 2, 3)]
        expect(sameOutline(items, [heading('A', 1, 1), heading('B', 2, 3)])).toBe(true)
        expect(sameOutline(items, [heading('A', 1, 1), heading('B', 2, 4)])).toBe(false)
        expect(sameOutline(items, [heading('A', 1, 1), heading('B', 3, 3)])).toBe(false)
        expect(sameOutline(items, [heading('A', 1, 1)])).toBe(false)
        expect(sameOutline(items, [heading('A', 1, 1), { ...heading('B', 2, 3), id: 'b-1' }])).toBe(false)
        expect(sameOutline(items, [heading('A', 1, 1), { ...heading('B', 2, 3), text: 'b' }])).toBe(false)
    })
})
