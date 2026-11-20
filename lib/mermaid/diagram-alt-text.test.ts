import { describe, expect, it } from 'vitest'
import { diagramAltText, diagramKindName, diagramName } from '@/lib/mermaid/diagram-alt-text'

describe('diagramAltText', () => {
    it("uses the diagram's own accTitle and accDescr", () => {
        expect(diagramAltText('flowchart TD\n  accTitle: Login flow\n  accDescr: How a user signs in\n  A[Start] --> B[End]')).toEqual({
            name: 'Login flow',
            description: 'Login flow. How a user signs in',
        })
        expect(diagramAltText('sequenceDiagram\n  accTitle: Chat?\n  accDescr {\n    Alice greets\n    Bob }\n  Alice->>Bob: Hi')).toEqual({
            name: 'Chat?',
            description: 'Chat? Alice greets Bob',
        })
        expect(diagramAltText('classDiagram\n  accDescr: Only a description\n  class Animal')).toEqual({
            name: 'Class diagram',
            description: 'Only a description',
        })
        expect(diagramAltText('xychart-beta\n  title "Monthly sales"\n  x-axis [jan, feb]\n  bar [1, 2]')).toEqual({
            name: 'Monthly sales',
            description: 'Monthly sales',
        })
    })

    it('names the kind of diagram and its first few labels otherwise', () => {
        expect(
            diagramAltText(
                [
                    '%%{init: {"theme": "dark"}}%%',
                    'flowchart LR',
                    '  subgraph Group [Group title]',
                    '  A[Start here] -->|yes| B{Is it ok?}',
                    '  end',
                    '  B --> C["Line one<br>line two"]',
                    '  B -- no --> D((Done & dusted))',
                    '  D --> E>Flag] & F[/Slanted/] & G[[Sub]] & H{{Hex}}',
                    '  A --> B',
                    '  classDef hot fill:#f00',
                ].join('\n')
            )
        ).toEqual({
            name: 'Flowchart',
            description: 'Flowchart: Start here, Is it ok?, Line one line two, Done & dusted, Flag, and 3 more',
        })
        expect(diagramAltText('sequenceDiagram\n  participant A as Alice\n  actor Bob\n  A->>Bob: Hello\n  Bob-->>Carol: Pass it on')).toEqual({
            name: 'Sequence diagram',
            description: 'Sequence diagram: Alice, Bob, Carol',
        })
        expect(diagramAltText('classDiagram\n  class Animal {\n    +name: string\n  }\n  Animal <|-- Dog\n  Dog *-- "many" Leg')).toEqual({
            name: 'Class diagram',
            description: 'Class diagram: Animal, Dog, Leg',
        })
        expect(diagramAltText('stateDiagram-v2\n  [*] --> Idle\n  state "Running fast" as Run\n  Idle --> Run : go\n  Run --> [*]')).toEqual({
            name: 'State diagram',
            description: 'State diagram: Idle, Running fast',
        })
        expect(
            diagramAltText('erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    string id PK\n  }\n  ORDER }|..|{ LINE-ITEM : has')
        ).toEqual({
            name: 'Entity relationship diagram',
            description: 'Entity relationship diagram: CUSTOMER, ORDER, LINE-ITEM',
        })
    })

    it('reads the diagram the way the renderer tidies it: after front matter, and one statement per line', () => {
        expect(diagramAltText('---\nconfig:\n  look: handDrawn\n---\ngraph TD\n  A[Start] --> B[End]')).toEqual({
            name: 'Flowchart',
            description: 'Flowchart: Start, End',
        })
        expect(diagramAltText('graph TD; A[Start] --> B[End]')).toEqual({ name: 'Flowchart', description: 'Flowchart: Start, End' })
        expect(diagramAltText('%% Steps\nsequenceDiagram;\n  Alice->>Bob: Hi')).toEqual({
            name: 'Sequence diagram',
            description: 'Sequence diagram: Alice, Bob',
        })
    })

    it('uses the title in front matter, after accTitle', () => {
        const source = '---\ntitle: "Order flow"\n---\ngraph TD\n  A[Start] --> B[End]'
        expect(diagramAltText(source)).toEqual({ name: 'Order flow', description: 'Order flow' })
        expect(diagramAltText(source.replace('graph TD', 'graph TD\n  accDescr: How an order moves'))).toEqual({
            name: 'Order flow',
            description: 'Order flow. How an order moves',
        })
        expect(diagramAltText(source.replace('graph TD', 'graph TD\n  accTitle: Orders'))).toEqual({ name: 'Orders', description: 'Orders' })
        expect(diagramAltText('---\ntitle: Pets\n---\npie\n  "Dogs" : 3')).toEqual({ name: 'Pets', description: 'Pets' })
    })

    it('falls back to the kind alone when there is nothing to name', () => {
        expect(diagramAltText('graph TD\n  A --> B')).toEqual({ name: 'Flowchart', description: 'Flowchart' })
        expect(diagramAltText('gantt\n  dateFormat YYYY-MM-DD')).toEqual({ name: 'Gantt chart', description: 'Gantt chart' })
        expect(diagramAltText('zenuml\n  A.method()')).toEqual({ name: 'Diagram', description: 'Diagram' })
        expect(diagramAltText('')).toEqual({ name: 'Diagram', description: 'Diagram' })
    })

    it.each([
        ['pie\n  "Dogs" : 3', 'Pie chart'],
        ['gantt\n  dateFormat YYYY-MM-DD', 'Gantt chart'],
        ['mindmap\n  root((Plans))', 'Mind map'],
        ['journey\n  section Morning', 'User journey'],
        ['gitGraph\n  commit', 'Git graph'],
        ['timeline\n  2024 : Launch', 'Timeline'],
        ['quadrantChart\n  x-axis Low --> High', 'Quadrant chart'],
        ['requirementDiagram\n  requirement r { id: 1 }', 'Requirement diagram'],
        ['C4Context\n  Person(a, "A")', 'C4 diagram'],
        ['C4Deployment\n  Node(a, "A")', 'C4 diagram'],
        ['sankey-beta\n  a,b,1', 'Sankey diagram'],
        ['block-beta\n  a b', 'Block diagram'],
        ['packet-beta\n  0-15: "Source"', 'Packet diagram'],
        ['kanban\n  Todo', 'Kanban board'],
        ['architecture-beta\n  service db(database)[DB]', 'Architecture diagram'],
        ['radar-beta\n  axis a, b, c', 'Radar chart'],
        ['treemap-beta\n  "A": 1', 'Treemap'],
    ])('names %j for what it is', (source, name) => {
        expect(diagramAltText(source).name).toBe(name)
        expect(diagramKindName(source)).toBe(name)
    })

    it("names the official package's types after their own title", () => {
        expect(diagramAltText('pie title Pets\n  "Dogs" : 386\n  "Cats" : 85')).toEqual({ name: 'Pets', description: 'Pets' })
        expect(diagramAltText('pie showData title Pets adopted\n  "Dogs" : 386')).toEqual({ name: 'Pets adopted', description: 'Pets adopted' })
        expect(diagramAltText('gantt\n  title Release plan\n  dateFormat YYYY-MM-DD\n  Build :a1, 2024-01-01, 3d')).toEqual({
            name: 'Release plan',
            description: 'Release plan',
        })
        expect(diagramAltText('journey\n  title: My working day\n  section Go to work')).toEqual({
            name: 'My working day',
            description: 'My working day',
        })
        expect(diagramAltText('---\ntitle: Branches\n---\ngitGraph\n  commit')).toEqual({ name: 'Branches', description: 'Branches' })
    })

    it.each([
        ['timeline\n  title History of social media\n  2004 : Facebook', 'History of social media'],
        ['quadrantChart\n  title Reach and engagement\n  x-axis Low --> High', 'Reach and engagement'],
        ['C4Context\n  title System context\n  Person(a, "A")', 'System context'],
        ['packet-beta\n  title TCP packet\n  0-15: "Source"', 'TCP packet'],
        ['radar-beta\n  title Skills\n  axis a, b, c', 'Skills'],
        ['gitGraph\n  title Branches\n  commit', 'Branches'],
    ])('reads the title line of %j, whose grammar has one', (source, title) => {
        expect(diagramAltText(source).name).toBe(title)
    })

    it.each([
        ['mindmap\n  root\n    Title page\n    Other', 'Mind map', 'Mind map'],
        ['kanban\n  Todo\n    title Write the docs', 'Kanban board', 'Kanban board'],
        ['block-beta\n  title a', 'Block diagram', 'Block diagram'],
        ['sankey-beta\n  title page,b,1', 'Sankey diagram', 'Sankey diagram'],
        ['requirementDiagram\n  title r', 'Requirement diagram', 'Requirement diagram'],
    ])("doesn't take a node or card in %j for a title: the type has no title statement", (source, name, description) => {
        expect(diagramAltText(source)).toEqual({ name, description })
        expect(diagramName(source)).toEqual({ name, kind: name })
    })

    it('uses accTitle and accDescr before the chart title', () => {
        expect(diagramAltText('pie title Pets\n  accTitle: Pet count\n  accDescr: Dogs win\n  "Dogs" : 386')).toEqual({
            name: 'Pet count',
            description: 'Pet count. Dogs win',
        })
        expect(diagramAltText('gantt\n  accDescr: Two weeks of work\n  title Release plan')).toEqual({
            name: 'Release plan',
            description: 'Release plan. Two weeks of work',
        })
    })

    it("names a pie chart's first few slices when it has no title", () => {
        expect(diagramAltText('pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15')).toEqual({
            name: 'Pie chart',
            description: 'Pie chart: Dogs, Cats, Rats',
        })
    })
})

describe('diagramAltText and the renderer read the accessibility lines the same way', () => {
    it('names the diagram after the same-line description block from the text that follows it', () => {
        // The renderer keeps 'A --> B' after the closing brace, so the alt text names its nodes too.
        expect(diagramAltText('graph TD\n  accDescr { note } A[Alpha] --> B[Beta]')).toEqual({ name: 'Flowchart', description: 'note' })
        expect(diagramAltText('graph TD\n  accDescr {\n    still typing\n  A[Alpha] --> B[Beta]')).toEqual({
            name: 'Flowchart',
            description: 'Flowchart: Alpha, Beta',
        })
    })

    it('reads only the keywords as Mermaid writes them, as the renderer does', () => {
        // The renderer draws 'ACCTITLE' as a state, so the alt text doesn't read it as a title.
        expect(diagramAltText('stateDiagram-v2\n  ACCTITLE : States\n  [*] --> Idle')).toEqual({
            name: 'State diagram',
            description: 'State diagram: Idle',
        })
        expect(diagramAltText('graph TD\n  %% accTitle: in a comment\n  A[Start] --> B[End]')).toEqual({
            name: 'Flowchart',
            description: 'Flowchart: Start, End',
        })
    })
})

describe('diagramName', () => {
    it.each([
        ['graph TD\n  A[Start] --> B[End]', { name: 'Flowchart', kind: 'Flowchart' }],
        ['graph TD\n  accTitle: Sign-in\n  A --> B', { name: 'Sign-in', kind: 'Flowchart' }],
        ['---\ntitle: Orders\n---\ngraph TD\n  A --> B', { name: 'Orders', kind: 'Flowchart' }],
        ['pie title Pets\n  "Dogs" : 386', { name: 'Pets', kind: 'Pie chart' }],
        ['pie\n  "Dogs" : 386', { name: 'Pie chart', kind: 'Pie chart' }],
        ['gantt\n  title Release plan', { name: 'Release plan', kind: 'Gantt chart' }],
        ['', { name: 'Diagram', kind: 'Diagram' }],
    ])('names %j as the alt text does', (source, expected) => {
        expect(diagramName(source)).toEqual(expected)
        expect(diagramName(source).name).toBe(diagramAltText(source).name)
    })

    it('stays quick for a long diagram, and so does the alt text', () => {
        // One edge per line and no title, so the alt text names its nodes. That used to take time with the square of
        // the length (seconds at this size), and the canvas did it on every edit.
        const edges = Array.from({ length: 20_000 }, (_, i) => `  N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`)
        const source = `flowchart TD\n${edges.join('\n')}`
        const start = performance.now()
        expect(diagramName(source)).toEqual({ name: 'Flowchart', kind: 'Flowchart' })
        expect(diagramAltText(source).description).toBe('Flowchart: Node 0, Node 1, Node 2, Node 3, Node 4, and 19996 more')
        expect(performance.now() - start).toBeLessThan(2000)
    })
})
