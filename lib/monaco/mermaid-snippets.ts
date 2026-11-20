/**
 * Starters for each diagram type Scrivon draws: the one list that both Ctrl+Space (in .mmd and .mermaid files) and
 * the Diagram Starters window show. Each is labelled with the header you would type, so `seq` then Ctrl+Space finds
 * the sequence diagram. Bodies use Monaco's snippet syntax: Tab moves through the ${n:placeholders}.
 */

export type MermaidSnippet = {
    /** The header you type, which Ctrl+Space lists it under. */
    label: string
    /** Ctrl+Space's note beside the label. */
    description: string
    /** The name on its card in the Diagram Starters window. */
    name: string
    /** The line under the name on its card. */
    summary: string
    /** The name a new file from it starts with. */
    fileName: string
    body: string
}

export const MERMAID_SNIPPETS: readonly MermaidSnippet[] = [
    {
        label: 'flowchart',
        description: 'Flowchart starter',
        name: 'Flowchart',
        summary: 'Steps and decisions joined by arrows',
        fileName: 'flowchart.mmd',
        body: [
            'flowchart ${1:TD}',
            '    ${2:A}[${3:Start}] --> ${4:B}{${5:Choice}}',
            '    $4 -->|${6:Yes}| ${7:C}[${8:Do it}]',
            '    $4 -->|${9:No}| ${10:D}[${11:Skip it}]',
        ].join('\n'),
    },
    {
        label: 'sequenceDiagram',
        description: 'Sequence diagram starter',
        name: 'Sequence diagram',
        summary: 'Messages passed between participants, in order',
        fileName: 'sequence.mmd',
        body: [
            'sequenceDiagram',
            '    participant ${1:A} as ${2:Alice}',
            '    participant ${3:B} as ${4:Bob}',
            '    $1->>$3: ${5:Hello}',
            '    $3-->>$1: ${6:Hi back}',
        ].join('\n'),
    },
    {
        label: 'classDiagram',
        description: 'Class diagram starter',
        name: 'Class diagram',
        summary: 'Classes, their members and how they relate',
        fileName: 'class.mmd',
        body: [
            'classDiagram',
            '    class ${1:Animal} {',
            '        +String ${2:name}',
            '        +${3:move}() void',
            '    }',
            '    $1 <|-- ${4:Dog}',
        ].join('\n'),
    },
    {
        label: 'stateDiagram-v2',
        description: 'State diagram starter',
        name: 'State diagram',
        summary: 'States and the events that move between them',
        fileName: 'state.mmd',
        body: ['stateDiagram-v2', '    [*] --> ${1:Idle}', '    $1 --> ${2:Busy} : ${3:start}', '    $2 --> [*]'].join('\n'),
    },
    {
        label: 'erDiagram',
        description: 'Entity relationship diagram starter',
        name: 'Entity relationship diagram',
        summary: 'Entities, their fields and the links between them',
        fileName: 'entity-relationship.mmd',
        body: ['erDiagram', '    ${1:CUSTOMER} ||--o{ ${2:ORDER} : ${3:places}', '    $1 {', '        string ${4:name}', '    }'].join('\n'),
    },
    {
        label: 'xychart-beta',
        description: 'XY chart starter',
        name: 'XY chart',
        summary: 'A bar chart with labelled axes',
        fileName: 'xy-chart.mmd',
        body: [
            'xychart-beta',
            '    title "${1:Sales}"',
            '    x-axis [${2:Jan, Feb, Mar}]',
            '    y-axis "${3:Revenue}" 0 --> ${4:100}',
            '    bar [${5:40, 60, 80}]',
        ].join('\n'),
    },
]
