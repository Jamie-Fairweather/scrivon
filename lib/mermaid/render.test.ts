import { renderMermaidSVG } from 'beautiful-mermaid'
import { describe, expect, it, vi } from 'vitest'
import {
    addMessageLabelHalo,
    getMermaidRenderOptions,
    renderMermaidDiagram,
    renderMermaidDiagramForExport,
    renderMermaidDiagramForExportAsync,
    stripRemoteFontImports,
} from '@/lib/mermaid/render'

const renderOfficialDiagram = vi.hoisted(() => vi.fn(async () => '<svg official/>'))
vi.mock('@/lib/mermaid/render-official', () => ({ renderOfficialDiagram }))

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

    it.each([
        ['a flag node', 'graph TD\n  A>x;y] --> B[End]'],
        ['edge text', 'graph TD\n  A[Start] -- x;y --> B[End]'],
        ['dotted edge text', 'graph TD\n  A[Start] -. x;y .-> B[End]'],
        ['thick edge text', 'graph TD\n  A[Start] == x;y ==> B[End]'],
    ])('draws a semicolon in %s as it did before the tidy-up', (_name, source) => {
        const before = addMessageLabelHalo(stripRemoteFontImports(renderMermaidSVG(source, getMermaidRenderOptions('scrivon-light'))))
        expect(before).toContain('>x;y</text>')
        expect(renderMermaidDiagram(source, 'scrivon-light')).toBe(before)
    })

    it('says ZenUML is not supported yet, for the preview and for exports', async () => {
        const zenuml = 'zenuml\n  A.method()'
        expect(() => renderMermaidDiagram(zenuml, 'scrivon-light')).toThrow(/^ZenUML diagrams aren't supported yet\. Scrivon can draw:\n• Flowcharts/)
        expect(() => renderMermaidDiagramForExport(zenuml, 'scrivon-light')).toThrow(/^ZenUML diagrams aren't supported yet/)
        await expect(renderMermaidDiagramForExportAsync(zenuml, 'scrivon-light')).rejects.toThrow(/^ZenUML diagrams aren't supported yet/)
    })

    it("exports the official mermaid package's types through it, on a background unless transparent", async () => {
        const pie = 'pie title Pets\n  "Dogs" : 386'
        renderOfficialDiagram.mockClear()
        await expect(renderMermaidDiagramForExportAsync(pie, 'nord')).resolves.toBe('<svg official/>')
        await renderMermaidDiagramForExportAsync(pie, 'nord', { transparent: true, labelHalo: false })
        expect(renderOfficialDiagram.mock.calls).toEqual([
            [pie, 'nord', { transparent: false }],
            [pie, 'nord', { transparent: true }],
        ])
    })

    it("exports beautiful-mermaid's own types as before, never through the official package", async () => {
        renderOfficialDiagram.mockClear()
        expect(await renderMermaidDiagramForExportAsync(SEQUENCE, 'scrivon-light')).toBe(renderMermaidDiagramForExport(SEQUENCE, 'scrivon-light'))
        expect(await renderMermaidDiagramForExportAsync(SEQUENCE, 'scrivon-light', { labelHalo: false, transparent: true })).toBe(
            renderMermaidDiagramForExport(SEQUENCE, 'scrivon-light', { labelHalo: false, transparent: true })
        )
        expect(renderOfficialDiagram).not.toHaveBeenCalled()
    })

    it('only edits style blocks, never diagram text', () => {
        const label = "@import url('https://fonts.googleapis.com/x');"
        const svg = `<svg><style>\n  @import url('https://fonts.googleapis.com/css2?family=Inter&amp;display=swap');\n  text { fill: red; }\n</style><text>${label}</text></svg>`
        expect(stripRemoteFontImports(svg)).toBe(`<svg><style>\n  text { fill: red; }\n</style><text>${label}</text></svg>`)
    })
})
