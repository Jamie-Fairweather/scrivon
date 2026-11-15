import type { languages } from 'monaco-editor'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'

/**
 * Mermaid for the editor: colours for .mmd and .mermaid files and for ```mermaid blocks in Markdown,
 * `%%` comments with Ctrl+/, and indented blocks in braces. Node ids stay in the body text colour, so
 * keywords, arrows and labels stand out.
 */

export const MERMAID_LANGUAGE_ID = 'mermaid'

/** Monaco's `IndentAction` values. Only the editor's types are loaded here, not its code. */
const INDENT: languages.IndentAction = 1
const INDENT_OUTDENT: languages.IndentAction = 2

export const mermaidLanguageConfiguration: languages.LanguageConfiguration = {
    comments: { lineComment: '%%' },
    // Mermaid uses brackets unpaired, in arrows (`||--o{`, `-)`) and in the flag shape (`A>flag]`), and the
    // editor would paint those red. So it pairs none, and brackets keep the theme's colour, not a rainbow.
    brackets: [],
    // Enter after `{` (a class, a state, an entity) indents the next line; between `{` and `}` it puts `}` on a line below.
    onEnterRules: [
        { beforeText: /\{\s*$/, afterText: /^\s*\}/, action: { indentAction: INDENT_OUTDENT } },
        { beforeText: /\{\s*$/, action: { indentAction: INDENT } },
    ],
    autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '{', close: '}' },
        { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
    ],
}

export const mermaidMonarchLanguage: languages.IMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.mermaid',

    keywords: [
        // Diagram headers.
        'graph',
        'flowchart',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'erDiagram',
        'xychart',
        // Flowcharts.
        'subgraph',
        'end',
        'direction',
        'class',
        'click',
        'href',
        'call',
        // Sequence diagrams.
        'participant',
        'actor',
        'as',
        'loop',
        'alt',
        'else',
        'opt',
        'par',
        'and',
        'critical',
        'option',
        'break',
        'rect',
        'box',
        'Note',
        'note',
        'over',
        'left',
        'right',
        'of',
        'activate',
        'deactivate',
        'autonumber',
        'create',
        'destroy',
        // Class and state diagrams.
        'namespace',
        'for',
        'state',
        // XY charts.
        'bar',
        'line',
        'horizontal',
    ],

    directions: ['TD', 'TB', 'BT', 'LR', 'RL'],

    tokenizer: {
        // Front matter (`---` … `---`) can only come first.
        start: [
            [/^\s*---\s*$/, { token: 'meta.separator', switchTo: '@frontMatter' }],
            [/\s+/, ''],
            [/./, { token: '@rematch', switchTo: '@root' }],
        ],
        frontMatter: [
            [/^\s*---\s*$/, { token: 'meta.separator', switchTo: '@root' }],
            [/^(\s*)([\w-]+)(\s*:)(.*)$/, ['', 'attribute.name', 'delimiter', 'string']],
            [/.+$/, 'string'],
        ],

        root: [
            [/\s+/, ''],
            [/%%.*$/, 'comment'],

            // Statements that style nodes: the styles read as one value.
            [/(classDef)(\s+)([\w-]+)(.*)$/, ['keyword', '', 'type', 'string']],
            [/(style)(\s+)([\w,-]+)(.*)$/, ['keyword', '', '', 'string']],
            [/(linkStyle)(\s+)(default|[\d,]+)(.*)$/, ['keyword', '', 'number', 'string']],
            // Text that runs to the end of the line.
            [/(accTitle|accDescr)(\s*)(:)(.*)$/, ['keyword', '', 'delimiter', 'string']],
            [/(title)(\s+)(.*)$/, ['keyword', '', 'string']],

            // Headers and keywords with a dash in them.
            [/(?:stateDiagram-v2|xychart-beta|x-axis|y-axis)(?![\w-])/, 'keyword'],
            // A state diagram's start and end.
            [/\[\*\]/, 'keyword'],
            // <<interface>>, <<fork>>, <<choice>> and the like.
            [/<<[\w\s]+>>/, 'type'],

            // Arrows and relationships. Entity relationship ends first (`||--o{`), then sequence
            // arrows (`->>`, `-x`, `-)`), then flowchart and class links (`-->`, `-.->`, `==>`, `<|--`, `..>`).
            [/(?:\|o|\|\||\}o|\}\|)(?:--|\.\.)(?:o\||\|\||o\{|\|\{)/, 'operator'],
            [/<<-{1,2}>>|-{1,2}>>|-{1,2}[x)](?!\w)|->(?!>)/, 'operator'],
            [/(?:<\||[<ox*])?(?:-{2,}|={2,}|\.{2,}|-\.+-|~{3,})(?:\|>|[>ox*])?/, 'operator'],

            // Edge text: -->|yes|
            [/(\|)([^|]*)(\|)/, ['delimiter', 'string', 'delimiter']],
            // Class names on a node: A:::warning
            [/(:::)([\w-]+)/, ['delimiter', 'type']],
            // Messages, notes and descriptions after a colon.
            [/(:)(.*)$/, ['delimiter', 'string']],

            [/"[^"]*"?/, 'string'],

            // A block over several lines: a class, a state or an entity.
            [/\{(?=\s*$)/, 'delimiter.bracket'],
            [/\}/, 'delimiter.bracket'],
            // Node shapes: [box], (round), {choice}, ((circle)), [[sub]], [(database)], {{hexagon}} and more.
            [/\[\[|\[\(|\[\/|\[\\|\(\(\(|\(\(|\(\[|\{\{|[[({]/, { token: 'delimiter.bracket', next: '@label' }],
            // The flag shape opens with `>` straight after the node id: A>flag]
            [/(\w+)(>)/, ['', { token: 'delimiter.bracket', next: '@label' }]],

            [/\d+(?:\.\d+)?(?![\w])/, 'number'],
            [/[A-Za-z_À-￿][\wÀ-￿]*/, { cases: { '@keywords': 'keyword', '@directions': 'keyword', '@default': '' } }],
        ],

        label: [
            [/"[^"]*"?/, 'string'],
            [/\]\]|\)\]|\/\]|\\\]|\)\)\)|\)\)|\]\)|\}\}|[\])}]/, { token: 'delimiter.bracket', next: '@pop' }],
            [/[^\])}"/\\]+/, 'string'],
            [/./, 'string'],
        ],
    },
}

/**
 * Registers Mermaid with the editor. The Markdown grammar finds it by name for ```mermaid blocks.
 * The starters are snippets, which the editor shows only when they are turned on (see code-editor-panel.tsx).
 */
export function registerMermaidLanguage(monaco: Pick<typeof import('monaco-editor'), 'languages'>): void {
    const { languages } = monaco
    languages.register({ id: MERMAID_LANGUAGE_ID, extensions: ['.mmd', '.mermaid'], aliases: ['Mermaid', 'mermaid'] })
    languages.setMonarchTokensProvider(MERMAID_LANGUAGE_ID, mermaidMonarchLanguage)
    languages.setLanguageConfiguration(MERMAID_LANGUAGE_ID, mermaidLanguageConfiguration)
    languages.registerCompletionItemProvider(MERMAID_LANGUAGE_ID, {
        provideCompletionItems(model, position) {
            // The header typed so far, dashes and all (`stateDiagram-`), so the starter replaces all of it.
            const line = model.getLineContent(position.lineNumber)
            let start = position.column - 1
            while (start > 0 && /[\w-]/.test(line[start - 1]!)) start--
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: start + 1,
                endColumn: position.column,
            }
            return {
                suggestions: MERMAID_SNIPPETS.map((snippet) => ({
                    label: snippet.label,
                    kind: languages.CompletionItemKind.Snippet,
                    detail: snippet.description,
                    insertText: snippet.body,
                    insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                })),
            }
        },
    })
}
