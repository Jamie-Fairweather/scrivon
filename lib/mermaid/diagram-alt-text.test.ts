import { describe, expect, it } from 'vitest'
import { diagramAltText } from '@/lib/mermaid/diagram-alt-text'

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

    it('falls back to the kind alone when there is nothing to name', () => {
        expect(diagramAltText('graph TD\n  A --> B')).toEqual({ name: 'Flowchart', description: 'Flowchart' })
        expect(diagramAltText('pie\n  "Dogs" : 3')).toEqual({ name: 'Diagram', description: 'Diagram' })
        expect(diagramAltText('')).toEqual({ name: 'Diagram', description: 'Diagram' })
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
