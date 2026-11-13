import { describe, expect, it } from 'vitest'
import { prepareMermaidSource, supportedDiagramsSentence } from '@/lib/mermaid/prepare-source'

describe('supportedDiagramsSentence', () => {
    it('names the supported types for a sentence', () => {
        expect(supportedDiagramsSentence()).toBe(
            'flowcharts, sequence diagrams, class diagrams, state diagrams, entity relationship diagrams and XY charts'
        )
    })
})

describe('prepareMermaidSource', () => {
    it('blanks front matter, keeping the line count', () => {
        const source = '---\ntitle: Order flow\nconfig:\n  look: handDrawn\n---\ngraph TD\n  A --> B'
        expect(prepareMermaidSource(source)).toBe('\n\n\n\n\ngraph TD\n  A --> B')
    })

    it.each([
        ['graph TD;\n  A --> B;', 'graph TD\n  A --> B'],
        ['flowchart LR ;\n  A --> B', 'flowchart LR\n  A --> B'],
        ['stateDiagram-v2;\n  [*] --> A', 'stateDiagram-v2\n  [*] --> A'],
    ])('drops the semicolon after the header: %j', (source, expected) => {
        expect(prepareMermaidSource(source)).toBe(expected)
    })

    it('puts flowchart statements joined by semicolons on lines of their own', () => {
        expect(prepareMermaidSource('graph TD; A --> B; B --> C')).toBe('graph TD\n A --> B\n B --> C')
    })

    it('keeps semicolons inside labels, quotes and edge text', () => {
        const source = 'graph TD\n  A["x; y"] --> B[a;b]\n  B -->|yes; no| C(c;d)'
        expect(prepareMermaidSource(source)).toBe(source)
    })

    it.each([
        ['graph\n  A --> B', 'graph TD\n  A --> B'],
        ['flowchart;\n  A --> B', 'flowchart TD\n  A --> B'],
    ])('gives a bare graph header the default top-down direction: %j', (source, expected) => {
        expect(prepareMermaidSource(source)).toBe(expected)
    })

    it('leaves comment lines before the header out, so the diagram type is still found', () => {
        expect(prepareMermaidSource('%% Login steps\n%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  A->>B: hi')).toBe(
            '\n\nsequenceDiagram\n  A->>B: hi'
        )
    })

    it('blanks accessibility lines, as the renderer would draw them as nodes', () => {
        expect(prepareMermaidSource('graph TD\n  accTitle: Login\n  A --> B')).toBe('graph TD\n\n  A --> B')
    })

    it.each([
        ['pie title Pets\n  "Dogs" : 386', 'Pie charts'],
        ['gantt\n  title Plan', 'Gantt charts'],
        ['mindmap\n  root', 'Mind maps'],
        ['---\ntitle: Week\n---\njourney\n  title My day', 'User journeys'],
        ['%% branches\ngitGraph\n  commit', 'Git graphs'],
        ['C4Context\n  title System', 'C4 diagrams'],
        ['sankey-beta\n  a,b,1', 'Sankey diagrams'],
    ])('says plainly that %j is not supported yet, and lists what is', (source, name) => {
        expect(() => prepareMermaidSource(source)).toThrow(
            `${name} aren't supported yet. Scrivon can draw:\n` +
                '• Flowcharts (flowchart TD or graph LR)\n' +
                '• Sequence diagrams (sequenceDiagram)\n' +
                '• Class diagrams (classDiagram)\n' +
                '• State diagrams (stateDiagram-v2)\n' +
                '• Entity relationship diagrams (erDiagram)\n' +
                '• XY charts (xychart-beta)'
        )
    })

    it.each(['graf TD\n  A --> B', 'constructor\n  A --> B'])('leaves a header it does not know to the renderer, which quotes it: %j', (source) => {
        expect(prepareMermaidSource(source)).toBe(source)
    })
})
