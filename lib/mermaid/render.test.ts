import { renderMermaidSVG } from 'beautiful-mermaid'
import { describe, expect, it } from 'vitest'
import {
    addMessageLabelHalo,
    getMermaidRenderOptions,
    renderMermaidDiagram,
    renderMermaidDiagramForExport,
    stripRemoteFontImports,
} from '@/lib/mermaid/render'

const FLOWCHART = 'graph TD\n  A[Start] --> B[End]'
const CLASS_DIAGRAM = 'classDiagram\n  class Animal {\n    +String name\n    +eat() void\n  }'
const SEQUENCE = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Reply'
const NETWORK = /@import|googleapis|gstatic/
const HALO = /\.message text \{ paint-order: stroke; stroke: var\(--bg\);[^}]*\}\n<\/style>/

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

    it('gives sequence message labels a background halo so lifelines stop short of the text (U82)', () => {
        expect(renderMermaidDiagram(SEQUENCE, 'scrivon-light')).toMatch(HALO)
        expect(renderMermaidDiagramForExport(SEQUENCE, 'scrivon-light')).toMatch(HALO)
        expect(renderMermaidDiagramForExport(SEQUENCE, 'scrivon-light', { labelHalo: false })).not.toContain('paint-order')
    })

    it('leaves other diagrams alone (U82)', () => {
        expect(renderMermaidDiagram(FLOWCHART, 'scrivon-light')).not.toContain('paint-order')
        expect(renderMermaidDiagram(CLASS_DIAGRAM, 'scrivon-light')).not.toContain('paint-order')
        const svg = '<svg><style>\n</style><g class="node"><text>message</text></g></svg>'
        expect(addMessageLabelHalo(svg)).toBe(svg)
    })

    it.each([
        ['front matter', '---\ntitle: Order flow\n---\ngraph TD\n  A[Start] --> B[End]'],
        ['a semicolon after the header', 'graph TD;\n  A[Start] --> B[End];'],
        ['a bare graph header', 'graph\n  A[Start] --> B[End]'],
        ['statements on one line', 'graph LR; A[Start] --> B[End]'],
    ])('draws a flowchart written with %s', (_name, source) => {
        for (const svg of [renderMermaidDiagram(source, 'scrivon-light'), renderMermaidDiagramForExport(source, 'scrivon-light')]) {
            expect(svg).toContain('>Start</text>')
            expect(svg).toContain('>End</text>')
        }
    })

    it('says a pie chart is not supported yet, for the preview and for exports', () => {
        const pie = 'pie title Pets\n  "Dogs" : 386'
        expect(() => renderMermaidDiagram(pie, 'scrivon-light')).toThrow(/^Pie charts aren't supported yet\. Scrivon can draw:\n• Flowcharts/)
        expect(() => renderMermaidDiagramForExport(pie, 'scrivon-light')).toThrow(/^Pie charts aren't supported yet/)
    })

    it('only edits style blocks, never diagram text', () => {
        const label = "@import url('https://fonts.googleapis.com/x');"
        const svg = `<svg><style>\n  @import url('https://fonts.googleapis.com/css2?family=Inter&amp;display=swap');\n  text { fill: red; }\n</style><text>${label}</text></svg>`
        expect(stripRemoteFontImports(svg)).toBe(`<svg><style>\n  text { fill: red; }\n</style><text>${label}</text></svg>`)
    })
})
