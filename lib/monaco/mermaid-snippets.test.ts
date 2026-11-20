import { SnippetParser } from 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js'
import { describe, expect, it } from 'vitest'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { snippetText } from '@/lib/monaco/snippet-text'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

/** The text a snippet puts in the editor before anything is typed over it. */
function expand(body: string): string {
    return new SnippetParser().parse(body).toString()
}

describe('Mermaid snippets', () => {
    it('offer one starter for each diagram type Scrivon draws, named by the header you type', () => {
        expect(MERMAID_SNIPPETS.map(({ label, description }) => [label, description])).toEqual([
            ['flowchart', 'Flowchart starter'],
            ['sequenceDiagram', 'Sequence diagram starter'],
            ['classDiagram', 'Class diagram starter'],
            ['stateDiagram-v2', 'State diagram starter'],
            ['erDiagram', 'Entity relationship diagram starter'],
            ['xychart-beta', 'XY chart starter'],
        ])
    })

    it('give each a name, a one-line summary and its own .mmd file name for the Diagram Starters window', () => {
        for (const { name, summary, fileName } of MERMAID_SNIPPETS) {
            expect(name).not.toBe('')
            expect(summary).not.toMatch(/\n/)
            expect(fileName).toMatch(/^[a-z-]+\.mmd$/)
        }
        expect(new Set(MERMAID_SNIPPETS.map(({ fileName }) => fileName)).size).toBe(MERMAID_SNIPPETS.length)
        expect(new Set(MERMAID_SNIPPETS.map(({ name }) => name)).size).toBe(MERMAID_SNIPPETS.length)
    })

    it('expand to plain text with no placeholder markers, as snippetText gives it', () => {
        for (const { body } of MERMAID_SNIPPETS) {
            expect(snippetText(body)).toBe(expand(body))
            expect(snippetText(body)).not.toMatch(/\$/)
        }
    })

    it.each(MERMAID_SNIPPETS.map((snippet) => [snippet.label, snippet] as const))('%s draws as it is inserted', (label, snippet) => {
        const text = expand(snippet.body)
        expect(text.startsWith(label)).toBe(true)
        expect(getSvgDimensions(renderMermaidDiagram(text, 'scrivon-light'))).not.toBeNull()
    })
})
