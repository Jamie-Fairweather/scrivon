import { describe, expect, it } from 'vitest'
import { extractMermaidBlockSources, locateMermaidBlock } from './mermaid-block-sources'

const fence = (lang: string, body: string) => ['```' + lang, body, '```'].join('\n')

describe('extractMermaidBlockSources', () => {
    it('returns every Mermaid block in document order, without the closing newline', () => {
        const markdown = ['# Title', fence('mermaid', 'flowchart TD\n  A --> B'), 'text', fence('Mermaid', 'pie\n  "a": 1')].join('\n\n')
        expect(extractMermaidBlockSources(markdown)).toEqual(['flowchart TD\n  A --> B', 'pie\n  "a": 1'])
    })

    it('ignores other code blocks, inline code and info strings that only start with mermaid', () => {
        const markdown = [
            fence('', 'plain'),
            fence('ts', 'const a = 1'),
            '`mermaid inline`',
            fence('mermaid-js', 'x'),
            fence('mermaid title', 'graph LR'),
        ].join('\n\n')
        expect(extractMermaidBlockSources(markdown)).toEqual(['graph LR'])
    })

    it('finds blocks inside lists and quotes, and an empty block', () => {
        const markdown = ['- item\n\n  ```mermaid\n  graph TD\n  ```', '> ```mermaid\n> pie\n> ```', fence('mermaid', '')].join('\n\n')
        expect(extractMermaidBlockSources(markdown)).toEqual(['graph TD', 'pie', ''])
    })

    it('orders footnote blocks the way the preview renders them (at the end, unused ones dropped)', () => {
        const markdown = [
            'Intro[^a]',
            '[^a]: Note\n\n    ```mermaid\n    graph FOOT\n    ```',
            '[^unused]: Unused\n\n    ```mermaid\n    graph UNUSED\n    ```',
            fence('mermaid', 'graph BODY'),
        ].join('\n\n')
        expect(extractMermaidBlockSources(markdown)).toEqual(['graph BODY', 'graph FOOT'])
    })
})

describe('locateMermaidBlock', () => {
    const block = { ordinal: 1, source: 'graph B' }

    it('keeps the block when nothing changed', () => {
        expect(locateMermaidBlock(block, ['graph A', 'graph B'], 2)).toBe(block)
    })

    it('follows edits to the block itself', () => {
        expect(locateMermaidBlock(block, ['graph A', 'graph B2'], 2)).toEqual({ ordinal: 1, source: 'graph B2' })
        expect(locateMermaidBlock(block, ['graph A', 'graph B2'], null)).toEqual({ ordinal: 1, source: 'graph B2' })
    })

    it('follows the block when another one is added or removed before it', () => {
        expect(locateMermaidBlock(block, ['graph NEW', 'graph A', 'graph B'], 2)).toEqual({ ordinal: 2, source: 'graph B' })
        expect(locateMermaidBlock(block, ['graph B'], 2)).toEqual({ ordinal: 0, source: 'graph B' })
    })

    it('gives up when the block is gone', () => {
        expect(locateMermaidBlock(block, ['graph A'], 2)).toBeNull()
        expect(locateMermaidBlock(block, ['graph A'], 1)).toBeNull()
        expect(locateMermaidBlock(block, ['graph A', 'graph C', 'graph D'], 2)).toBeNull()
    })
})
