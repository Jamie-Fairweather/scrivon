import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_SHOWCASE } from '@/lib/examples/markdown-showcase'
import { emitTs, parseMarkdown, unescapeMarkdown } from './generate-examples.mjs'

const readLf = (path: string) => readFileSync(join(__dirname, path), 'utf8').replace(/\r\n/g, '\n')

const contents = (lines: string) => `Contents\n\n${lines}\n`

const section = (heading: string, description: string, source: string) =>
    `## ${heading}\n\n${description}\n\n\`\`\`\n${source}\n\`\`\`\n\nEdit\n\n\`\`\`\nRendering…\n\`\`\`\n`

function sampleDoc(toc: string, sections: string[]) {
    return `${contents(toc)}\n## Samples\n\n${sections.join('\n')}`
}

describe('unescapeMarkdown', () => {
    it('drops backslash escapes in plain text', () => {
        expect(unescapeMarkdown('Composition (\\*--)')).toBe('Composition (*--)')
        expect(unescapeMarkdown('a \\_b\\_ \\\\ c')).toBe('a _b_ \\ c')
    })

    it('keeps backslashes inside code spans', () => {
        expect(unescapeMarkdown('trapezoid `[/text\\]` and \\*')).toBe('trapezoid `[/text\\]` and *')
    })
})

describe('parseMarkdown', () => {
    it('pairs each listed sample with the section of the same title, not by position', () => {
        const md = sampleDoc(
            [
                '### Flowchart (2 samples)',
                '1. [1. Simple Flow](#sample-1)',
                '2. [2. linkStyle: Edges](#sample-2)',
                '### Class (1 samples)',
                '1. [3. Composition (\\*--)](#sample-3)',
            ].join('\n'),
            [
                section('Class: Composition (\\*--)', 'Owns.', 'classDiagram\n  A *-- B'),
                section('linkStyle: Edges', 'Colours.', 'graph LR\n  C --> D'),
                section('Simple Flow', 'Start to end.', 'graph TD\n  A --> B'),
            ]
        )

        expect(parseMarkdown(md)).toEqual([
            { id: 'sample-1', category: 'flowchart', title: 'Simple Flow', description: 'Start to end.', source: 'graph TD\n  A --> B' },
            { id: 'sample-2', category: 'flowchart', title: 'linkStyle: Edges', description: 'Colours.', source: 'graph LR\n  C --> D' },
            { id: 'sample-3', category: 'class', title: 'Composition (*--)', description: 'Owns.', source: 'classDiagram\n  A *-- B' },
        ])
    })

    it('fails when a section is not in the contents list', () => {
        const md = sampleDoc('### Flowchart (1 samples)\n1. [1. Simple Flow](#sample-1)', [
            section('Simple Flow', 'Start to end.', 'graph TD\n  A --> B'),
            section('Extra Sample', 'New upstream.', 'graph TD\n  X --> Y'),
        ])
        expect(() => parseMarkdown(md)).toThrow(/missing from the contents list: "Extra Sample"/)
    })

    it('fails when a listed sample has no section', () => {
        const md = sampleDoc('### Flowchart (2 samples)\n1. [1. Simple Flow](#sample-1)\n2. [2. Gone](#sample-2)', [
            section('Simple Flow', 'Start.', 'graph TD\n  A --> B'),
        ])
        expect(() => parseMarkdown(md)).toThrow(/No sample section titled "Gone"/)
    })

    it('fails on a category it does not know', () => {
        const md = sampleDoc('### Gantt (1 samples)\n1. [1. Plan](#sample-1)', [section('Gantt: Plan', 'Dates.', 'gantt\n  title Plan')])
        expect(() => parseMarkdown(md)).toThrow(/Unknown category "Gantt"/)
    })

    it('fails when a heading count does not match the samples listed under it', () => {
        const md = sampleDoc('### Flowchart (2 samples)\n1. [1. Simple Flow](#sample-1)', [section('Simple Flow', 'Start.', 'graph TD\n  A --> B')])
        expect(() => parseMarkdown(md)).toThrow(/says 2 samples but 1 are listed/)
    })

    it('fails when a section has no diagram code', () => {
        const md = sampleDoc('### Flowchart (1 samples)\n1. [1. Simple Flow](#sample-1)', ['## Simple Flow\n\nNo code here.\n'])
        expect(() => parseMarkdown(md)).toThrow(/"Simple Flow" has no diagram code/)
    })
})

describe('bundled samples', () => {
    const examples = parseMarkdown(readLf('data/craft-mermaid-samples.md'))

    it('reads every sample with plain-text titles and descriptions', () => {
        expect(examples).toHaveLength(84)
        expect(examples.find((ex: { id: string }) => ex.id === 'sample-51')?.title).toBe('Composition (*--)')
        expect(examples.find((ex: { id: string }) => ex.id === 'sample-47')?.description).toContain('`<<interface>>`')
        for (const ex of examples) {
            expect(ex.title).not.toContain('\\')
            expect(ex.description).not.toContain('<\\>')
            expect(ex.source).not.toBe('')
        }
    })

    it('matches the committed lib/examples/craft-samples.ts', () => {
        expect(readLf('../lib/examples/craft-samples.ts')).toBe(emitTs(examples))
    })
})

describe('markdown syntax showcase', () => {
    const source = readLf('data/markdown-syntax-showcase.md')

    it('matches the committed lib/examples/markdown-showcase.ts', () => {
        expect(MARKDOWN_SHOWCASE.source).toBe(source.trim())
    })

    // Prettier once rewrote these to the other syntax, so the examples no longer showed what they said.
    it('uses the syntax each example names', () => {
        expect(source).toContain('Heading level 1\n===============\n')
        expect(source).toContain('Heading level 2\n---------------\n')
        expect(source).toContain('*Italic* with asterisks, _italic_ with underscores.')
        expect(source).toContain('**Bold** with asterisks, __bold__ with underscores.')
        expect(source).toContain('\n* Asterisk\n\n+ Plus\n')
        expect(source).toContain('Three or more of:\n\n***\n\n---\n\n___\n')
        expect(source).toContain('\n*[HTML]: Hyper Text Markup Language\n*[W3C]: World Wide Web Consortium\n')
    })
})
