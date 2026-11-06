import { renderMermaidSVG } from 'beautiful-mermaid'
import { describe, expect, it } from 'vitest'
import { getMermaidRenderOptions, renderMermaidDiagram, renderMermaidDiagramForExport, stripRemoteFontImports } from '@/lib/mermaid/render'

const FLOWCHART = 'graph TD\n  A[Start] --> B[End]'
const CLASS_DIAGRAM = 'classDiagram\n  class Animal {\n    +String name\n    +eat() void\n  }'
const NETWORK = /@import|googleapis|gstatic/

describe('diagram rendering', () => {
    it('beautiful-mermaid itself still asks Google for fonts (so the strip below matters)', () => {
        expect(renderMermaidSVG(FLOWCHART, getMermaidRenderOptions('scrivon-light'))).toContain('fonts.googleapis.com')
    })

    it.each([
        ['flowchart', FLOWCHART],
        ['class diagram (also loads a mono font)', CLASS_DIAGRAM],
    ])('the preview %s loads no fonts from the network', (_name, source) => {
        const svg = renderMermaidDiagram(source, 'scrivon-light')
        expect(svg).not.toMatch(NETWORK)
        expect(svg).toContain("text { font-family: 'Inter', system-ui, sans-serif; }")
    })

    it.each([
        ['flowchart', FLOWCHART],
        ['class diagram', CLASS_DIAGRAM],
    ])('the export %s loads no fonts from the network', (_name, source) => {
        expect(renderMermaidDiagramForExport(source, 'tokyo-night')).not.toMatch(NETWORK)
    })

    it('only edits style blocks, never diagram text', () => {
        const label = "@import url('https://fonts.googleapis.com/x');"
        const svg = `<svg><style>\n  @import url('https://fonts.googleapis.com/css2?family=Inter&amp;display=swap');\n  text { fill: red; }\n</style><text>${label}</text></svg>`
        expect(stripRemoteFontImports(svg)).toBe(`<svg><style>\n  text { fill: red; }\n</style><text>${label}</text></svg>`)
    })
})
