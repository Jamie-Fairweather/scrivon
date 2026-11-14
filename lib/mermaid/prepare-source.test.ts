import { describe, expect, it } from 'vitest'
import { prepareMermaidSource, readFrontMatterTitle, supportedDiagramsSentence, unsupportedDiagramNote } from '@/lib/mermaid/prepare-source'

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
        'graph TD\n  A>x;y] --> B[End]',
        'graph TD\n  A[Start] -- a;b --> B[End]',
        'graph TD\n  A[Start] -. a;b .-> B[End]',
        'graph TD\n  A[Start] == a;b ==> B[End]',
        'graph TD\n  A <-- a;b --- B',
        'graph TD\n  A -->|[a;b| B',
    ])('keeps semicolons inside a flag node and inline edge text: %j', (source) => {
        expect(prepareMermaidSource(source)).toBe(source)
    })

    it('still splits at a semicolon after inline edge text, a flag node or an arrow', () => {
        expect(prepareMermaidSource('graph TD; A -- a;b --> B; B>c;d] --- C; C <--> D;')).toBe('graph TD\n A -- a;b --> B\n B>c;d] --- C\n C <--> D')
    })

    it('reads edge text up to the next arrow with a space before it, as the renderer does', () => {
        // The renderer reads this as one link from A to D, so it stays one statement.
        expect(prepareMermaidSource('graph TD; A -- x; B -- y; C --> D')).toBe('graph TD\n A -- x; B -- y; C --> D')
        // No arrow closes the edge text, so the semicolons split it as usual.
        expect(prepareMermaidSource('graph TD; A -- x; B -- y; C-->D')).toBe('graph TD\n A -- x\n B -- y\n C-->D')
        expect(prepareMermaidSource('graph TD; A --  ; B')).toBe('graph TD\n A --  \n B')
    })

    it('stays quick on very long lines, so a file can not freeze an export', () => {
        const spaces = ' '.repeat(100_000)
        const started = performance.now()
        expect(prepareMermaidSource(`sequenceDiagram${spaces}x`)).toBe(`sequenceDiagram${spaces}x`)
        expect(prepareMermaidSource(`sequenceDiagram${spaces};`)).toBe('sequenceDiagram')
        expect(prepareMermaidSource(`graph TD\n  A ${'-- x '.repeat(20_000)}; B`)).toBe(`graph TD\n  A ${'-- x '.repeat(20_000)}\n B`)
        expect(prepareMermaidSource(`graph TD\n  A ${'-- x --> B '.repeat(10_000)}; B`)).toBe(`graph TD\n  A ${'-- x --> B '.repeat(10_000)}\n B`)
        expect(performance.now() - started).toBeLessThan(1000)
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

describe('unsupportedDiagramNote', () => {
    it.each([
        ['pie title Pets\n  "Dogs" : 386', 'Pie chart: not supported in Scrivon yet'],
        ['---\ntitle: Week\n---\njourney\n  title My day', 'User journey: not supported in Scrivon yet'],
        ['%% branches\ngitGraph\n  commit', 'Git graph: not supported in Scrivon yet'],
        ['sankey-beta\n  a,b,1', 'Sankey diagram: not supported in Scrivon yet'],
        ['treemap\n  "A": 1', 'Treemap: not supported in Scrivon yet'],
    ])('gives readers of an export one short line for %j, without the help', (source, note) => {
        expect(unsupportedDiagramNote(source)).toBe(note)
    })

    it.each(['graph TD\n  A --> B', 'sequenceDiagram\n  A->>B: hi', '', '%% just a note', 'graf TD'])('has nothing to say about %j', (source) => {
        expect(unsupportedDiagramNote(source)).toBeNull()
    })
})

describe('readFrontMatterTitle', () => {
    it.each([
        ['---\ntitle: Order flow\n---\ngraph TD', 'Order flow'],
        ['\n---\r\nconfig:\r\n  title: nested\r\ntitle:  "Quoted"  \r\n---\r\ngraph TD', '"Quoted"'],
        ['---\ntitle:\n---\ngraph TD', null],
        ['---\nconfig: {}\n---\ngraph TD', null],
        ['---\ntitle: Never closed\ngraph TD', null],
        ['graph TD\n---\ntitle: Not at the top\n---', null],
        ['', null],
    ])('reads the title from front matter at the top: %j', (source, title) => {
        expect(readFrontMatterTitle(source)).toBe(title)
    })
})
