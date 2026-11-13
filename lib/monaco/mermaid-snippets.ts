/**
 * Starters for each diagram type Scrivon draws, offered in .mmd and .mermaid files by Ctrl+Space.
 * Each is labelled with the header you would type, so `seq` then Ctrl+Space finds the sequence diagram.
 * Bodies use Monaco's snippet syntax: Tab moves through the ${n:placeholders}.
 */

export type MermaidSnippet = { label: string; description: string; body: string }

export const MERMAID_SNIPPETS: readonly MermaidSnippet[] = [
    {
        label: 'flowchart',
        description: 'Flowchart starter',
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
        body: ['stateDiagram-v2', '    [*] --> ${1:Idle}', '    $1 --> ${2:Busy} : ${3:start}', '    $2 --> [*]'].join('\n'),
    },
    {
        label: 'erDiagram',
        description: 'Entity relationship diagram starter',
        body: ['erDiagram', '    ${1:CUSTOMER} ||--o{ ${2:ORDER} : ${3:places}', '    $1 {', '        string ${4:name}', '    }'].join('\n'),
    },
    {
        label: 'xychart-beta',
        description: 'XY chart starter',
        body: [
            'xychart-beta',
            '    title "${1:Sales}"',
            '    x-axis [${2:Jan, Feb, Mar}]',
            '    y-axis "${3:Revenue}" 0 --> ${4:100}',
            '    bar [${5:40, 60, 80}]',
        ].join('\n'),
    },
]
