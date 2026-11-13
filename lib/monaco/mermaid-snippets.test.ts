import { SnippetParser } from 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js'
import { describe, expect, it } from 'vitest'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
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

    it.each(MERMAID_SNIPPETS.map((snippet) => [snippet.label, snippet] as const))('%s draws as it is inserted', (label, snippet) => {
        const text = expand(snippet.body)
        expect(text.startsWith(label)).toBe(true)
        expect(getSvgDimensions(renderMermaidDiagram(text, 'scrivon-light'))).not.toBeNull()
    })
})
