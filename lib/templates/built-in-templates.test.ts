import { SnippetParser } from 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js'
import { describe, expect, it } from 'vitest'
import { titleFromFileName } from '@/lib/default-markdown'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { readFrontMatterTitle } from '@/lib/mermaid/prepare-source'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import { BUILT_IN_TEMPLATES } from '@/lib/templates/built-in-templates'
import { fillTemplate } from '@/lib/templates/fill-template'
import { documentKind } from '@/lib/workspace/file-types'

const NOW = new Date(2026, 10, 19, 14, 30)

const diagramTemplates = BUILT_IN_TEMPLATES.filter((template) => documentKind(template.fileName) === 'mermaid')
const expandSnippet = (body: string) => new SnippetParser().parse(body).toString()
const lines = (text: string) => text.split('\n').map((line) => line.trim())

describe('built-in templates', () => {
    it('ship meeting notes, a decision record, a project brief and a process flowchart, in that order', () => {
        expect(BUILT_IN_TEMPLATES.map(({ title, fileName }) => [title, fileName])).toEqual([
            ['Meeting notes', 'meeting-notes.md'],
            ['Decision record', 'decision-record.md'],
            ['Project brief', 'project-brief.md'],
            ['Process flowchart', 'process-flow.mmd'],
        ])
        expect(new Set(BUILT_IN_TEMPLATES.map((template) => template.id)).size).toBe(BUILT_IN_TEMPLATES.length)
        for (const template of BUILT_IN_TEMPLATES) expect(template.description).not.toBe('')
    })

    it('start each document with a heading from the title', () => {
        for (const template of BUILT_IN_TEMPLATES.filter((t) => documentKind(t.fileName) === 'markdown')) {
            const filled = fillTemplate(template.source, { title: 'Plan', now: NOW, kind: 'markdown' })
            expect(filled.startsWith('# Plan\n')).toBe(true)
            expect(filled).not.toMatch(/\{\{/)
        }
    })

    it("don't repeat a diagram starter that Ctrl+Space already offers", () => {
        expect(diagramTemplates.length).toBeGreaterThan(0)
        for (const template of diagramTemplates) {
            const templateLines = lines(template.source)
            for (const snippet of MERMAID_SNIPPETS) {
                const starterBody = lines(expandSnippet(snippet.body)).slice(1)
                // Not the same text, and not the starter's lines with a title added.
                expect(starterBody.every((line) => templateLines.includes(line))).toBe(false)
            }
        }
    })

    describe.each(diagramTemplates.map((template) => [template.title, template] as const))('%s', (_title, template) => {
        it.each(['Plan', 'Q3 [draft] #2 (v1); 50%'])('takes the title %j and draws in light and dark', (title) => {
            const filled = fillTemplate(template.source, { title: titleFromFileName(`${title}.mmd`), now: NOW, kind: 'mermaid' })

            expect(readFrontMatterTitle(filled)).toBe(`"${title}"`)
            for (const theme of ['scrivon-light', 'scrivon-dark'] as const) {
                let svg = ''
                expect(() => {
                    svg = renderMermaidDiagramForExport(filled, theme)
                }).not.toThrow()
                expect(getSvgDimensions(svg)).not.toBeNull()
            }
        })
    })
})
