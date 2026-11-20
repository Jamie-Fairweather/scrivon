import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { insertDiagramStarter, starterInsertProblem, STARTER_INSERT_PROBLEMS, type StarterFileKind } from '@/lib/monaco/diagram-starter-insert'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { snippetText } from '@/lib/monaco/snippet-text'

// The real editor and its snippet controller (a .tsx test, so it runs in happy-dom), as the snippet's placeholders,
// line endings and undo step are Monaco's own.
let monaco: typeof Monaco
beforeAll(async () => {
    monaco = (await import('monaco-editor/editor')) as unknown as typeof Monaco
    await import('monaco-editor/editor/contrib/snippet/browser/snippetController2.js')
}, 60_000)

const created: Monaco.editor.IStandaloneCodeEditor[] = []
afterEach(() => {
    for (const codeEditor of created.splice(0)) {
        codeEditor.getModel()?.dispose()
        codeEditor.dispose()
    }
})

const FLOWCHART = MERMAID_SNIPPETS[0]
const FLOWCHART_TEXT = snippetText(FLOWCHART.body)
const FENCE = `\`\`\`mermaid\n${FLOWCHART_TEXT}\n\`\`\``

/** An editor on `text`, with the selection from `[line, column]` to `[line, column]` (both from 1). */
function editorOn(text: string, from: [number, number] = [1, 1], to: [number, number] = from, eol: '\n' | '\r\n' = '\n') {
    const model = monaco.editor.createModel(text.replace(/\n/g, eol), 'plaintext')
    const codeEditor = monaco.editor.create(document.createElement('div'), { model })
    created.push(codeEditor)
    codeEditor.setSelection({ selectionStartLineNumber: from[0], selectionStartColumn: from[1], positionLineNumber: to[0], positionColumn: to[1] })
    return { codeEditor, model }
}

function insert(codeEditor: Monaco.editor.ICodeEditor, kind: StarterFileKind, snippet = FLOWCHART) {
    return insertDiagramStarter(codeEditor, kind, snippet)
}

describe('insertDiagramStarter in a Markdown file', () => {
    it('puts the starter in a ```mermaid block after the caret line, with a blank line either side', () => {
        const { codeEditor, model } = editorOn('Intro text\nNext', [1, 4])
        expect(insert(codeEditor, 'markdown')).toBeNull()
        expect(model.getValue()).toBe(`Intro text\n\n${FENCE}\n\nNext`)
    })

    it('takes the place of a blank caret line', () => {
        const { codeEditor, model } = editorOn('Intro\n\nNext', [2, 1])
        insert(codeEditor, 'markdown')
        expect(model.getValue()).toBe(`Intro\n\n${FENCE}\n\nNext`)
    })

    it('adds no blank line at the end of the file', () => {
        const { codeEditor, model } = editorOn('Intro\nLast', [2, 5])
        insert(codeEditor, 'markdown')
        expect(model.getValue()).toBe(`Intro\nLast\n\n${FENCE}`)
    })

    it('keeps a selection, going after the line it ends on', () => {
        const { codeEditor, model } = editorOn('First line\nSecond line\nThird', [1, 3], [2, 4])
        insert(codeEditor, 'markdown')
        expect(model.getValue()).toBe(`First line\nSecond line\n\n${FENCE}\n\nThird`)
    })

    it('uses the file’s own line endings', () => {
        const { codeEditor, model } = editorOn('Intro\nNext', [1, 1], [1, 1], '\r\n')
        insert(codeEditor, 'markdown')
        expect(model.getValue()).toBe(`Intro\n\n${FENCE}\n\nNext`.replace(/\n/g, '\r\n'))
    })

    it('changes nothing inside a code block, and says why', () => {
        const text = 'Intro\n```js\ncode\n```'
        const { codeEditor, model } = editorOn(text, [3, 2])
        expect(starterInsertProblem(codeEditor, 'markdown')).toBe(STARTER_INSERT_PROBLEMS.inCodeBlock)
        expect(insert(codeEditor, 'markdown')).toBe(STARTER_INSERT_PROBLEMS.inCodeBlock)
        expect(model.getValue()).toBe(text)
    })

    it('is undone in one step, and Tab moves through the placeholders', () => {
        const { codeEditor, model } = editorOn('Intro', [1, 6])
        insert(codeEditor, 'markdown')
        // The first placeholder (the direction, TD) is selected.
        expect(model.getValueInRange(codeEditor.getSelection()!)).toBe('TD')
        codeEditor.trigger('test', 'jumpToNextSnippetPlaceholder', null)
        expect(model.getValueInRange(codeEditor.getSelection()!)).toBe('A')

        model.undo()
        expect(model.getValue()).toBe('Intro')
    })
})

describe('insertDiagramStarter in a diagram file', () => {
    it('fills an empty or whitespace-only file', () => {
        const { codeEditor, model } = editorOn('  \n\n', [2, 1])
        expect(starterInsertProblem(codeEditor, 'mermaid')).toBeNull()
        expect(insert(codeEditor, 'mermaid', MERMAID_SNIPPETS[1])).toBeNull()
        expect(model.getValue()).toBe(snippetText(MERMAID_SNIPPETS[1].body))
    })

    it('leaves a file with text alone, and says why', () => {
        const { codeEditor, model } = editorOn('flowchart LR\n  A --> B')
        expect(starterInsertProblem(codeEditor, 'mermaid')).toBe(STARTER_INSERT_PROBLEMS.diagramHasText)
        expect(insert(codeEditor, 'mermaid')).toBe(STARTER_INSERT_PROBLEMS.diagramHasText)
        expect(model.getValue()).toBe('flowchart LR\n  A --> B')
    })

    it('checks again as it inserts, so text typed since stops it', () => {
        const { codeEditor, model } = editorOn('')
        expect(starterInsertProblem(codeEditor, 'mermaid')).toBeNull()
        model.setValue('graph TD')
        expect(insert(codeEditor, 'mermaid')).toBe(STARTER_INSERT_PROBLEMS.diagramHasText)
        expect(model.getValue()).toBe('graph TD')
    })
})

describe('starterInsertProblem', () => {
    it('refuses a read-only file and other kinds of file', () => {
        const { codeEditor } = editorOn('')
        expect(starterInsertProblem(codeEditor, 'other')).toBe(STARTER_INSERT_PROBLEMS.otherFile)
        codeEditor.updateOptions({ readOnly: true })
        expect(starterInsertProblem(codeEditor, 'mermaid')).toBe(STARTER_INSERT_PROBLEMS.readOnly)
    })

    it('refuses an editor with no file', () => {
        const { codeEditor } = editorOn('')
        codeEditor.setModel(null)
        expect(starterInsertProblem(codeEditor, 'markdown')).toBe(STARTER_INSERT_PROBLEMS.noFile)
    })
})
