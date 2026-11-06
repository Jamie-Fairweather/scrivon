import { describe, expect, it } from 'vitest'
import { diagramAltText, stripAccessibilityLines } from '@/lib/mermaid/diagram-alt-text'

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

describe('stripAccessibilityLines', () => {
    it('takes out accTitle, accDescr and accDescr blocks, which the renderer would draw as boxes', () => {
        expect(stripAccessibilityLines('flowchart TD\n  accTitle: Login flow\n  accDescr: How a user signs in\n  A[Start] --> B[End]')).toBe(
            'flowchart TD\n  A[Start] --> B[End]'
        )
        expect(stripAccessibilityLines('flowchart TD\n  accDescr {\n    multi\n    line }\n  A --> B')).toBe('flowchart TD\n  A --> B')
        expect(stripAccessibilityLines('stateDiagram-v2\n  ACCTITLE : States\n  accDescr { one line }\n  [*] --> Idle')).toBe(
            'stateDiagram-v2\n  [*] --> Idle'
        )
        // Diagram text after a block's closing brace stays.
        expect(stripAccessibilityLines('graph TD\n  accDescr { note } A --> B')).toBe('graph TD\n A --> B')
    })

    it('keeps every other line as it is, and a block that never closes', () => {
        const plain = '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  %% accTitle: in a comment\n  A[accTitle] --> B\n'
        expect(stripAccessibilityLines(plain)).toBe(plain)
        const open = 'flowchart TD\n  accDescr {\n  A --> B'
        expect(stripAccessibilityLines(open)).toBe(open)
    })
})
