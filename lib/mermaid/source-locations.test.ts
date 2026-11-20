import { describe, expect, it } from 'vitest'
import { diagramPartsKind, locateDiagramTarget, locateInMarkdown, type SourceLocation, type TargetKey } from '@/lib/mermaid/source-locations'

const node = (id: string): TargetKey => ({ kind: 'node', id, from: '', to: '', occurrence: 0 })
const group = (id: string): TargetKey => ({ kind: 'group', id, from: '', to: '', occurrence: 0 })
const actor = (id: string): TargetKey => ({ kind: 'actor', id, from: '', to: '', occurrence: 0 })
const edge = (from: string, to: string, occurrence = 0): TargetKey => ({ kind: 'edge', id: '', from, to, occurrence })
const message = (from: string, to: string, occurrence = 0): TargetKey => ({ kind: 'message', id: '', from, to, occurrence })

/** The text a location selects, and its line: what the editor would show selected. */
function selected(source: string, target: TargetKey): { line: number; text: string } | null {
    const at = locateDiagramTarget(source, target)
    if (!at) return null
    const line = source.split('\n')[at.line - 1]!.replace(/\r$/, '')
    return { line: at.line, text: line.slice(at.column - 1, at.column - 1 + at.length) }
}

describe('diagramPartsKind', () => {
    it.each([
        ['graph TD\n  A --> B', 'flowchart'],
        ['flowchart LR; A --> B', 'flowchart'],
        ['---\ntitle: T\n---\n%% note\nstateDiagram-v2\n  A --> B', 'state'],
        ['accTitle: Hi\nsequenceDiagram\n  A->>B: x', 'sequence'],
        ['classDiagram\n  class A', 'other'],
        ['erDiagram\n  A ||--o{ B : has', 'other'],
        ['pie\n  "a" : 1', 'other'],
        ['', 'other'],
    ])('reads %j as %s', (source, kind) => {
        expect(diagramPartsKind(source)).toBe(kind)
    })
})

describe('locateDiagramTarget in a flowchart', () => {
    it('selects a node where it is first given a shape, otherwise where it is first mentioned', () => {
        const source = 'graph TD\n  A --> B\n  A[Start]'
        expect(selected(source, node('A'))).toEqual({ line: 3, text: 'A' })
        expect(selected(source, node('B'))).toEqual({ line: 2, text: 'B' })
        expect(locateDiagramTarget(source, node('A'))).toEqual({ line: 3, column: 3, length: 1 })
    })

    it('selects a link with its label, and only its own part of a chain', () => {
        const source = 'graph LR\n  A[Go] -->|yes| B --> C\n  C -- no --> D'
        expect(selected(source, edge('A', 'B'))).toEqual({ line: 2, text: 'A[Go] -->|yes| B' })
        expect(selected(source, edge('B', 'C'))).toEqual({ line: 2, text: 'B --> C' })
        expect(selected(source, edge('C', 'D'))).toEqual({ line: 3, text: 'C -- no --> D' })
    })

    it('selects the whole statement for each link of an & group', () => {
        const source = 'graph TD\n  A & B --> C & D'
        for (const [from, to] of [
            ['A', 'C'],
            ['A', 'D'],
            ['B', 'C'],
            ['B', 'D'],
        ]) {
            expect(selected(source, edge(from!, to!))).toEqual({ line: 2, text: 'A & B --> C & D' })
        }
        expect(selected(source, node('B'))).toEqual({ line: 2, text: 'B' })
        expect(locateDiagramTarget(source, node('D'))).toEqual({ line: 2, column: 17, length: 1 })
    })

    it('sends the nth link between the same two nodes to the nth line with one', () => {
        const source = 'graph TD\n  A --> B\n  B --> C\n  A -.-> B'
        expect(selected(source, edge('A', 'B', 0))).toEqual({ line: 2, text: 'A --> B' })
        expect(selected(source, edge('A', 'B', 1))).toEqual({ line: 4, text: 'A -.-> B' })
        expect(locateDiagramTarget(source, edge('A', 'B', 2))).toBeNull()
        // The other way round is another link.
        expect(locateDiagramTarget(source, edge('B', 'A'))).toBeNull()
    })

    it('keeps the lines and columns of several ; statements on one line', () => {
        const source = 'graph TD; A --> B; B[Two;three] --> C;\n  C --> A'
        expect(selected(source, edge('A', 'B'))).toEqual({ line: 1, text: 'A --> B' })
        expect(selected(source, edge('B', 'C'))).toEqual({ line: 1, text: 'B[Two;three] --> C' })
        expect(selected(source, node('B'))).toEqual({ line: 1, text: 'B' })
        expect(locateDiagramTarget(source, node('B'))).toEqual({ line: 1, column: 20, length: 1 })
        expect(selected(source, edge('C', 'A'))).toEqual({ line: 2, text: 'C --> A' })
    })

    it('selects a subgraph by its id, or by its title when it has no id', () => {
        const source = 'graph TD\n  subgraph one [First]\n    A\n  end\n  subgraph Second part\n    B\n  end'
        expect(selected(source, group('one'))).toEqual({ line: 2, text: 'one' })
        expect(selected(source, group('Second_part'))).toEqual({ line: 5, text: 'Second part' })
    })

    it('skips comments, front matter, accessibility lines and styling', () => {
        const source = [
            '---',
            'title: A --> B',
            '---',
            '%%{init: {"theme": "dark"}}%%',
            'graph TD',
            '  accTitle: A --> B',
            '  accDescr {',
            '    A --> B',
            '  }',
            '  %% A --> B',
            '  classDef hot fill:#f00',
            '  class A hot',
            '  style A fill:#f00',
            '  linkStyle 0 stroke:#f00',
            '  click A callback',
            '  A --> B',
        ].join('\n')
        expect(selected(source, edge('A', 'B'))).toEqual({ line: 16, text: 'A --> B' })
        expect(selected(source, node('A'))).toEqual({ line: 16, text: 'A' })
    })

    it('keeps the columns of text after an accDescr block closes', () => {
        const source = 'graph TD\n  accDescr { about\n  this } A --> B'
        expect(locateDiagramTarget(source, edge('A', 'B'))).toEqual({ line: 3, column: 10, length: 7 })
    })

    it('reads Windows line endings without counting the hidden returns', () => {
        const source = 'graph TD\r\n  A --> B\r\n  A[Start]\r\n'
        expect(locateDiagramTarget(source, node('A'))).toEqual({ line: 3, column: 3, length: 1 })
        expect(locateDiagramTarget(source, edge('A', 'B'))).toEqual({ line: 2, column: 3, length: 7 })
    })

    it('finds nothing for a part the text no longer has, or a kind a flowchart has none of', () => {
        const source = 'graph TD\n  A --> B'
        expect(locateDiagramTarget(source, node('Z'))).toBeNull()
        expect(locateDiagramTarget(source, edge('A', 'Z'))).toBeNull()
        expect(locateDiagramTarget(source, group('S'))).toBeNull()
        expect(locateDiagramTarget(source, actor('A'))).toBeNull()
        expect(locateDiagramTarget(source, message('A', 'B'))).toBeNull()
        expect(locateDiagramTarget('classDiagram\n  A <|-- B', node('A'))).toBeNull()
    })
})

describe('locateDiagramTarget in a state diagram', () => {
    const source = [
        'stateDiagram-v2',
        '  [*] --> Idle',
        '  Idle --> Busy : go',
        '  state "Long wait" as S1',
        '  Busy --> S1',
        '  Idle : waiting',
        '  Busy --> S1 : again',
        '  state Comp {',
        '    [*] --> X',
        '  }',
        '  S1 --> [*]',
    ].join('\n')

    it('selects a state where it gets its label, otherwise its first mention', () => {
        expect(selected(source, node('S1'))).toEqual({ line: 4, text: 'S1' })
        expect(selected(source, node('Idle'))).toEqual({ line: 6, text: 'Idle' })
        expect(selected(source, node('Busy'))).toEqual({ line: 3, text: 'Busy' })
        expect(selected(source, node('X'))).toEqual({ line: 9, text: 'X' })
    })

    it('selects transitions with their labels, repeats on their own lines', () => {
        expect(selected(source, edge('Idle', 'Busy'))).toEqual({ line: 3, text: 'Idle --> Busy : go' })
        expect(selected(source, edge('Busy', 'S1', 0))).toEqual({ line: 5, text: 'Busy --> S1' })
        expect(selected(source, edge('Busy', 'S1', 1))).toEqual({ line: 7, text: 'Busy --> S1 : again' })
    })

    it('numbers the start and end points as the renderer does', () => {
        expect(selected(source, edge('_start', 'Idle'))).toEqual({ line: 2, text: '[*] --> Idle' })
        expect(selected(source, edge('_start2', 'X'))).toEqual({ line: 9, text: '[*] --> X' })
        expect(selected(source, edge('S1', '_end'))).toEqual({ line: 11, text: 'S1 --> [*]' })
    })

    it('selects a composite state by its id', () => {
        expect(selected(source, group('Comp'))).toEqual({ line: 8, text: 'Comp' })
        expect(selected('stateDiagram-v2\n  state "Big one" as Big {\n  }', group('Big'))).toEqual({ line: 2, text: 'Big' })
    })
})

describe('locateDiagramTarget in a sequence diagram', () => {
    const source = [
        'sequenceDiagram',
        '  participant A as Alice',
        '  A->>B: Hello',
        '  B-->>A: Reply',
        '  loop Every minute',
        '    A->>+B: Hello',
        '  end',
        '  Note over A,C: Later',
        '  actor D',
    ].join('\n')

    it('selects a participant line, otherwise its first message, otherwise a note', () => {
        expect(selected(source, actor('A'))).toEqual({ line: 2, text: 'participant A as Alice' })
        expect(selected(source, actor('B'))).toEqual({ line: 3, text: 'B' })
        expect(locateDiagramTarget(source, actor('B'))).toEqual({ line: 3, column: 7, length: 1 })
        expect(selected(source, actor('C'))).toEqual({ line: 8, text: 'C' })
        expect(selected(source, actor('D'))).toEqual({ line: 9, text: 'actor D' })
    })

    it('selects the whole message after the indent, repeats on their own lines', () => {
        expect(selected(source, message('A', 'B', 0))).toEqual({ line: 3, text: 'A->>B: Hello' })
        expect(selected(source, message('B', 'A'))).toEqual({ line: 4, text: 'B-->>A: Reply' })
        expect(selected(source, message('A', 'B', 1))).toEqual({ line: 6, text: 'A->>+B: Hello' })
        expect(locateDiagramTarget(source, message('A', 'B', 2))).toBeNull()
        expect(locateDiagramTarget(source, node('A'))).toBeNull()
    })
})

describe('locateInMarkdown', () => {
    const at = (line: number, column: number, length: number): SourceLocation => ({ line, column, length })

    it('moves a place in the block to the Markdown file, below its fence', () => {
        const markdown = '# Title\n\n```mermaid\ngraph TD\n  A --> B\n```\n'
        expect(locateInMarkdown(markdown, 3, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(5, 3, 7))
    })

    it('finds the part past a list indent or a > quote', () => {
        const list = '- Item\n\n  ```mermaid\n  graph TD\n    A --> B\n  ```'
        expect(locateInMarkdown(list, 3, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(5, 5, 7))
        const quote = '> ```mermaid\n> graph TD\n>   A --> B\n> ```'
        expect(locateInMarkdown(quote, 1, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(3, 5, 7))
        const both = '1. Step\n   > ```mermaid\n   > graph TD\n   >   A --> B'
        expect(locateInMarkdown(both, 2, 'graph TD\n  A --> B', at(2, 3, 1))).toEqual(at(4, 8, 1))
    })

    it('starts a block written as raw HTML right after its <code> tag, on the <pre> line', () => {
        const markdown = '# T\n\n<pre><code class="language-mermaid">graph TD\n  A --> B</code></pre>\n'
        expect(locateInMarkdown(markdown, 3, 'graph TD\n  A --> B', at(2, 3, 1))).toEqual(at(4, 3, 1))
        expect(locateInMarkdown(markdown, 3, 'graph TD\n  A --> B', at(1, 1, 5))).toEqual(at(3, 37, 5))
        // The <code> tag on the line below the <pre>.
        const split = '<pre>\n<code class="language-mermaid">graph TD\n  A --> B</code>\n</pre>'
        expect(locateInMarkdown(split, 1, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(3, 3, 7))
    })

    it('reads Windows line endings', () => {
        expect(locateInMarkdown('```mermaid\r\ngraph TD\r\n  A --> B\r\n```', 1, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(3, 3, 7))
    })

    it('looks along the line when the part is not where it should be, and selects the line when it is gone', () => {
        const markdown = '```mermaid\ngraph TD\n    A --> B\n```'
        expect(locateInMarkdown(markdown, 1, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(3, 5, 7))
        expect(locateInMarkdown('```mermaid\ngraph TD\n  X --> Y\n```', 1, 'graph TD\n  A --> B', at(2, 3, 7))).toEqual(at(3, 1, 9))
        expect(locateInMarkdown('```mermaid', 1, 'graph TD\n  A --> B', at(2, 3, 7))).toBeNull()
    })
})
