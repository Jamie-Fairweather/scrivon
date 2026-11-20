import { describe, expect, it } from 'vitest'
import { diagramAltText, diagramKindName } from '@/lib/mermaid/diagram-alt-text'

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
