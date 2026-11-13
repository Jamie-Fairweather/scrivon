import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'
import { nodeText } from '@/lib/markdown/export-outline'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'

function parse(markdown: string): Root {
    const processor = unified().use(remarkParse).use(markdownRemarkPlugins)
    return processor.runSync(processor.parse(markdown), markdown) as Root
}

/** The text of each node of this type, outermost first, and how many sit inside another of the same type. */
function marked(tree: Root, type: 'strong' | 'emphasis' | 'delete') {
    const texts: string[] = []
    let nested = 0
    visit(tree, type, (node, _index, parent) => {
        texts.push(nodeText(node))
        if (parent?.type === type) nested++
    })
    return { texts, nested }
}

describe('markdownRemarkPlugins: emphasis next to Chinese and Japanese punctuation (B76)', () => {
    it('reads bold that starts or ends with 「」 or 。 as bold', () => {
        expect(marked(parse('**「重要」**です'), 'strong')).toEqual({ texts: ['「重要」'], nested: 0 })
        expect(marked(parse('これは*「例」*です。'), 'emphasis')).toEqual({ texts: ['「例」'], nested: 0 })
    })

    it('keeps bold in neighbouring sentences separate instead of nesting them', () => {
        const tree = parse('**「重要」**です。これは**テスト。**です。最後に**確認**します。')
        expect(marked(tree, 'strong')).toEqual({ texts: ['「重要」', 'テスト。', '確認'], nested: 0 })
    })

    it('reads strikethrough next to the same punctuation', () => {
        expect(marked(parse('~~「削除」~~です'), 'delete')).toEqual({ texts: ['「削除」'], nested: 0 })
    })

    it('still reads GitHub Markdown and English emphasis as before', () => {
        const tree = parse('Some **bold**, *italic* and ~~gone~~ text.\n\n| a |\n| - |\n| 1 |')
        expect(marked(tree, 'strong').texts).toEqual(['bold'])
        expect(marked(tree, 'emphasis').texts).toEqual(['italic'])
        expect(marked(tree, 'delete').texts).toEqual(['gone'])
        expect(tree.children.some((node) => node.type === 'table')).toBe(true)
    })
})

describe('markdownRemarkPlugins: math', () => {
    /** Each piece of math in the document, as `$…$` (inline) or `$$…$$` (a block of its own). */
    function maths(markdown: string): string[] {
        const found: string[] = []
        visit(parse(markdown), (node) => {
            if (node.type === 'inlineMath') found.push(`$${node.value}$`)
            if (node.type === 'math') found.push(`$$${node.value}$$`)
        })
        return found
    }

    it('reads $…$ as inline math and $$ lines as a block', () => {
        expect(maths('Inline: $E = mc^2$\n\n$$\n\\frac{1}{3}\n$$')).toEqual(['$E = mc^2$', '$$\\frac{1}{3}$$'])
    })

    it('keeps the text of math that has emphasis marks in it', () => {
        expect(maths('$a_1 * b_2 * c$')).toEqual(['$a_1 * b_2 * c$'])
    })

    it('leaves prices as text, as Pandoc does', () => {
        expect(maths('It costs $5 and $10.')).toEqual([])
        expect(maths('From $5 to $ 10, or $x$.')).toEqual(['$x$'])
        expect(parse('It costs $5 and $10.').children[0]).toMatchObject({ children: [{ type: 'text', value: 'It costs $5 and $10.' }] })
    })

    it('always reads $$…$$ in a line as math', () => {
        expect(maths('Sum $$ x + 1 $$ here')).toHaveLength(1)
    })

    it('reads an escaped dollar as a dollar', () => {
        expect(maths('\\$5 and \\$10')).toEqual([])
    })
})
