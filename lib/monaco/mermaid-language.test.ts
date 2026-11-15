import { SnippetParser } from 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js'
import { language as markdownLanguage } from 'monaco-editor/languages/definitions/markdown/markdown.js'
import { describe, expect, it, vi } from 'vitest'
import { MERMAID_LANGUAGE_ID, mermaidLanguageConfiguration, mermaidMonarchLanguage, registerMermaidLanguage } from '@/lib/monaco/mermaid-language'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { registerMonarchLanguage, tokenizeLines, type ColouredText } from '@/vitest/monarch'

registerMonarchLanguage(MERMAID_LANGUAGE_ID, mermaidMonarchLanguage)

/** The tokens of each line, without the whitespace around them (Monaco joins spaces onto plain text). */
function colours(text: string): ColouredText[][] {
    return tokenizeLines(MERMAID_LANGUAGE_ID, text).map((line) =>
        line.map(([part, type]): ColouredText => [part.trim(), type]).filter(([part]) => part !== '')
    )
}

describe('Mermaid grammar', () => {
    it('colours a flowchart: keywords, arrows, node shapes and their labels', () => {
        expect(colours('flowchart TD\n  A[Start] --> B{Choice}')).toEqual([
            [
                ['flowchart', 'keyword.mermaid'],
                ['TD', 'keyword.mermaid'],
            ],
            [
                ['A', ''],
                ['[', 'delimiter.bracket.mermaid'],
                ['Start', 'string.mermaid'],
                [']', 'delimiter.bracket.mermaid'],
                ['-->', 'operator.mermaid'],
                ['B', ''],
                ['{', 'delimiter.bracket.mermaid'],
                ['Choice', 'string.mermaid'],
                ['}', 'delimiter.bracket.mermaid'],
            ],
        ])
    })

    it('reads arrows written without spaces, and edge text', () => {
        expect(colours('A-->B\nA -->|yes| B\nA -.-> B\nA ==> B\nA --- B\nA <--> B\nA --x B')).toEqual([
            [
                ['A', ''],
                ['-->', 'operator.mermaid'],
                ['B', ''],
            ],
            [
                ['A', ''],
                ['-->', 'operator.mermaid'],
                ['|', 'delimiter.mermaid'],
                ['yes', 'string.mermaid'],
                ['|', 'delimiter.mermaid'],
                ['B', ''],
            ],
            ...['-.->', '==>', '---', '<-->', '--x'].map((arrow) => [
                ['A', ''],
                [arrow, 'operator.mermaid'],
                ['B', ''],
            ]),
        ])
    })

    it.each([
        ['((circle))', '((', 'circle', '))'],
        ['[[subroutine]]', '[[', 'subroutine', ']]'],
        ['[(database)]', '[(', 'database', ')]'],
        ['([stadium])', '([', 'stadium', '])'],
        ['{{hexagon}}', '{{', 'hexagon', '}}'],
        ['[/slant/]', '[/', 'slant', '/]'],
        ['(round)', '(', 'round', ')'],
        ['>flag]', '>', 'flag', ']'],
    ])('colours the %s node shape', (shape, open, label, close) => {
        expect(colours(`A${shape}`)).toEqual([
            [
                ['A', ''],
                [open, 'delimiter.bracket.mermaid'],
                [label, 'string.mermaid'],
                [close, 'delimiter.bracket.mermaid'],
            ],
        ])
    })

    it('keeps a quoted label whole, brackets and all', () => {
        expect(colours('A["Total [net]"]')).toEqual([
            [
                ['A', ''],
                ['[', 'delimiter.bracket.mermaid'],
                ['"Total [net]"', 'string.mermaid'],
                [']', 'delimiter.bracket.mermaid'],
            ],
        ])
    })

    it('dims %% comments, also before the header', () => {
        expect(colours('%% Login steps\ngraph LR\n  %% the happy path')).toEqual([
            [['%% Login steps', 'comment.mermaid']],
            [
                ['graph', 'keyword.mermaid'],
                ['LR', 'keyword.mermaid'],
            ],
            [['%% the happy path', 'comment.mermaid']],
        ])
    })

    it('colours front matter at the top as settings, then the diagram as usual', () => {
        expect(colours('---\ntitle: Order flow\n---\ngraph TD')).toEqual([
            [['---', 'meta.separator.mermaid']],
            [
                ['title', 'attribute.name.mermaid'],
                [':', 'delimiter.mermaid'],
                ['Order flow', 'string.mermaid'],
            ],
            [['---', 'meta.separator.mermaid']],
            [
                ['graph', 'keyword.mermaid'],
                ['TD', 'keyword.mermaid'],
            ],
        ])
    })

    it('colours subgraphs, classes and styles', () => {
        expect(colours('subgraph one [Checkout]\nend\nA:::warning\nclassDef warning fill:#f96,stroke:#333\nstyle A fill:#bbf')).toEqual([
            [
                ['subgraph', 'keyword.mermaid'],
                ['one', ''],
                ['[', 'delimiter.bracket.mermaid'],
                ['Checkout', 'string.mermaid'],
                [']', 'delimiter.bracket.mermaid'],
            ],
            [['end', 'keyword.mermaid']],
            [
                ['A', ''],
                [':::', 'delimiter.mermaid'],
                ['warning', 'type.mermaid'],
            ],
            [
                ['classDef', 'keyword.mermaid'],
                ['warning', 'type.mermaid'],
                ['fill:#f96,stroke:#333', 'string.mermaid'],
            ],
            [
                ['style', 'keyword.mermaid'],
                ['A', ''],
                ['fill:#bbf', 'string.mermaid'],
            ],
        ])
    })

    it('colours a sequence diagram: participants, arrows and messages', () => {
        expect(
            colours(
                'sequenceDiagram\n  participant A as Alice\n  A->>B: Hello; how are you?\n  B-->>A: Fine\n  Note right of A: Thinks\n  loop Every minute\n  end'
            )
        ).toEqual([
            [['sequenceDiagram', 'keyword.mermaid']],
            [
                ['participant', 'keyword.mermaid'],
                ['A', ''],
                ['as', 'keyword.mermaid'],
                ['Alice', ''],
            ],
            [
                ['A', ''],
                ['->>', 'operator.mermaid'],
                ['B', ''],
                [':', 'delimiter.mermaid'],
                ['Hello; how are you?', 'string.mermaid'],
            ],
            [
                ['B', ''],
                ['-->>', 'operator.mermaid'],
                ['A', ''],
                [':', 'delimiter.mermaid'],
                ['Fine', 'string.mermaid'],
            ],
            [
                ['Note', 'keyword.mermaid'],
                ['right', 'keyword.mermaid'],
                ['of', 'keyword.mermaid'],
                ['A', ''],
                [':', 'delimiter.mermaid'],
                ['Thinks', 'string.mermaid'],
            ],
            [
                ['loop', 'keyword.mermaid'],
                ['Every minute', ''],
            ],
            [['end', 'keyword.mermaid']],
        ])
    })

    it('colours a class diagram: relationships, annotations and member blocks', () => {
        expect(colours('classDiagram\n  Animal <|-- Duck\n  class Duck {\n    <<interface>>\n    +swim() void\n  }')).toEqual([
            [['classDiagram', 'keyword.mermaid']],
            [
                ['Animal', ''],
                ['<|--', 'operator.mermaid'],
                ['Duck', ''],
            ],
            [
                ['class', 'keyword.mermaid'],
                ['Duck', ''],
                ['{', 'delimiter.bracket.mermaid'],
            ],
            [['<<interface>>', 'type.mermaid']],
            [
                ['+swim', ''],
                ['()', 'delimiter.bracket.mermaid'],
                ['void', ''],
            ],
            [['}', 'delimiter.bracket.mermaid']],
        ])
    })

    it('colours a state diagram: start and end, and transitions', () => {
        expect(colours('stateDiagram-v2\n  [*] --> Still\n  Still --> [*] : done')).toEqual([
            [['stateDiagram-v2', 'keyword.mermaid']],
            [
                ['[*]', 'keyword.mermaid'],
                ['-->', 'operator.mermaid'],
                ['Still', ''],
            ],
            [
                ['Still', ''],
                ['-->', 'operator.mermaid'],
                ['[*]', 'keyword.mermaid'],
                [':', 'delimiter.mermaid'],
                ['done', 'string.mermaid'],
            ],
        ])
    })

    it('colours an entity relationship diagram: relationship ends and labels', () => {
        expect(colours('erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER }|..|{ LINE-ITEM : contains')).toEqual([
            [['erDiagram', 'keyword.mermaid']],
            [
                ['CUSTOMER', ''],
                ['||--o{', 'operator.mermaid'],
                ['ORDER', ''],
                [':', 'delimiter.mermaid'],
                ['places', 'string.mermaid'],
            ],
            [
                ['ORDER', ''],
                ['}|..|{', 'operator.mermaid'],
                ['LINE-ITEM', ''],
                [':', 'delimiter.mermaid'],
                ['contains', 'string.mermaid'],
            ],
        ])
    })

    it('colours an XY chart: axes, titles and numbers', () => {
        expect(colours('xychart-beta\n  title "Sales"\n  y-axis "Revenue" 0 --> 100\n  bar [5, 7.5]')).toEqual([
            [['xychart-beta', 'keyword.mermaid']],
            [
                ['title', 'keyword.mermaid'],
                ['"Sales"', 'string.mermaid'],
            ],
            [
                ['y-axis', 'keyword.mermaid'],
                ['"Revenue"', 'string.mermaid'],
                ['0', 'number.mermaid'],
                ['-->', 'operator.mermaid'],
                ['100', 'number.mermaid'],
            ],
            [
                ['bar', 'keyword.mermaid'],
                ['[', 'delimiter.bracket.mermaid'],
                ['5, 7.5', 'string.mermaid'],
                [']', 'delimiter.bracket.mermaid'],
            ],
        ])
    })

    it('colours ```mermaid blocks in Markdown, and Markdown again after the block', () => {
        registerMonarchLanguage('markdown', markdownLanguage)
        const lines = tokenizeLines('markdown', '```mermaid\ngraph TD\n  A --> B\n```\n# Next').map((line) =>
            line.filter(([part]) => part.trim() !== '')
        )
        expect(lines).toEqual([
            [['```mermaid', 'string.md']],
            [
                ['graph', 'keyword.mermaid'],
                ['TD', 'keyword.mermaid'],
            ],
            [
                ['  A ', ''],
                ['-->', 'operator.mermaid'],
                [' B', ''],
            ],
            [['```', 'string.md']],
            [['# Next', 'keyword.md']],
        ])
    })

    it('colours accessibility lines', () => {
        expect(colours('accTitle: Login flow')).toEqual([
            [
                ['accTitle', 'keyword.mermaid'],
                [':', 'delimiter.mermaid'],
                ['Login flow', 'string.mermaid'],
            ],
        ])
    })
})

/**
 * The brackets the editor would mark as unmatched in `text`. Like Monaco, it pairs the configured brackets
 * in every token except strings, comments and regexes, so arrows count too.
 */
function strayBrackets(text: string): string[] {
    const closers = new Map((mermaidLanguageConfiguration.brackets ?? []).map(([open, close]) => [open, close]))
    const closing = new Set(closers.values())
    const open: string[] = []
    const stray: string[] = []
    for (const line of tokenizeLines(MERMAID_LANGUAGE_ID, text)) {
        for (const [part, type] of line) {
            if (/\b(?:comment|string|regexp?)\b/.test(type)) continue
            for (const char of part) {
                if (closers.has(char)) open.push(closers.get(char)!)
                else if (closing.has(char) && open.at(-1) === char) open.pop()
                else if (closing.has(char)) stray.push(char)
            }
        }
    }
    return [...stray, ...open]
}

describe('mermaidLanguageConfiguration', () => {
    it.each([
        ...MERMAID_SNIPPETS.map((snippet) => [snippet.label, new SnippetParser().parse(snippet.body).toString()]),
        ['entity relationship ends', 'erDiagram\n  A ||--o{ B : has\n  B }|..|{ C : uses\n  C }o--o| D : maybe'],
        ['async sequence arrows', 'sequenceDiagram\n  A-)B: go\n  A--)B: back'],
        ['every node shape', 'graph TD\n  A[a] --> B(b) --> C{c} --> D((d)) --> E([e]) --> F[[f]] --> G[(g)] --> H{{h}} --> I>i]'],
    ])('pairs no bracket that Mermaid leaves unpaired, so none shows as unmatched: %s', (_name, text) => {
        expect(strayBrackets(text)).toEqual([])
    })

    it('pairs no brackets at all, so none is coloured by depth instead of by the theme', () => {
        expect(mermaidLanguageConfiguration.brackets).toEqual([])
        expect(mermaidLanguageConfiguration.colorizedBracketPairs).toBeUndefined()
    })

    it('indents a block in braces on Enter', () => {
        const [between, after] = mermaidLanguageConfiguration.onEnterRules!
        expect(between!.beforeText.test('  class Animal {') && between!.afterText!.test('}')).toBe(true)
        expect(between!.action.indentAction).toBe(2) // IndentOutdent
        expect(after!.beforeText.test('  CUSTOMER {')).toBe(true)
        expect(after!.afterText).toBeUndefined()
        expect(after!.action.indentAction).toBe(1) // Indent
        expect(after!.beforeText.test('  A{Choice}')).toBe(false)
    })
})

describe('registerMermaidLanguage', () => {
    function fakeMonaco() {
        return {
            languages: {
                register: vi.fn(),
                setMonarchTokensProvider: vi.fn(),
                setLanguageConfiguration: vi.fn(),
                registerCompletionItemProvider: vi.fn(),
                CompletionItemKind: { Snippet: 27 },
                CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
            },
        }
    }

    it('registers Mermaid for .mmd and .mermaid files and for ```mermaid blocks, with its colours and comments', () => {
        const monaco = fakeMonaco()
        registerMermaidLanguage(monaco as unknown as Parameters<typeof registerMermaidLanguage>[0])

        expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'mermaid', extensions: ['.mmd', '.mermaid'], aliases: ['Mermaid', 'mermaid'] })
        expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('mermaid', mermaidMonarchLanguage)
        expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('mermaid', mermaidLanguageConfiguration)
        expect(mermaidLanguageConfiguration.comments).toEqual({ lineComment: '%%' })
    })

    it('offers the starters as snippets that replace the word being typed', () => {
        const monaco = fakeMonaco()
        registerMermaidLanguage(monaco as unknown as Parameters<typeof registerMermaidLanguage>[0])
        const [language, provider] = monaco.languages.registerCompletionItemProvider.mock.calls[0]!
        expect(language).toBe('mermaid')

        const model = { getLineContent: () => 'seq' }
        const { suggestions } = provider.provideCompletionItems(model, { lineNumber: 1, column: 4 })
        const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 4 }
        expect(suggestions).toEqual(
            MERMAID_SNIPPETS.map((snippet) => ({
                label: snippet.label,
                kind: 27,
                detail: snippet.description,
                insertText: snippet.body,
                insertTextRules: 4,
                range,
            }))
        )
    })

    it.each([
        ['stateDiagram-', 14, 1],
        ['  xychart-be', 13, 3],
        ['%% x-axis', 10, 4],
        ['A --> B', 8, 7],
        ['stateDiagram-v2 more', 14, 1],
        ['', 1, 1],
    ])('replaces the whole header typed so far, dashes and all: %j at column %i', (line, column, startColumn) => {
        const monaco = fakeMonaco()
        registerMermaidLanguage(monaco as unknown as Parameters<typeof registerMermaidLanguage>[0])
        const [, provider] = monaco.languages.registerCompletionItemProvider.mock.calls[0]!
        const { suggestions } = provider.provideCompletionItems({ getLineContent: () => line }, { lineNumber: 3, column })
        expect(suggestions[0].range).toEqual({ startLineNumber: 3, endLineNumber: 3, startColumn, endColumn: column })
    })
})
