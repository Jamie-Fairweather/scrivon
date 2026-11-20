import type { IRange, editor } from 'monaco-editor'
import { placeFencedBlock } from '@/lib/markdown/fence-placement'
import type { MermaidSnippet } from '@/lib/monaco/mermaid-snippets'

/** The kind of file a starter goes in: a diagram file holds one diagram, a Markdown file gets a ```mermaid block. */
export type StarterFileKind = 'mermaid' | 'markdown' | 'other'

/** Why Insert can't put a starter in, in the words the Diagram Starters window shows. */
export const STARTER_INSERT_PROBLEMS = {
    noFile: 'No file open',
    readOnly: 'This file is read-only',
    diagramHasText: 'This diagram file already has text',
    inCodeBlock: 'The cursor is inside a code block',
    otherFile: 'Only in Markdown and diagram files',
} as const

/** The parts of Monaco's snippet controller used here (`editor.getContribution('snippetController2')`). */
type SnippetController = {
    insert(template: string, options?: { adjustWhitespace?: boolean; undoStopBefore?: boolean; undoStopAfter?: boolean }): void
    cancel(): void
}

export type StarterEditor = Pick<editor.ICodeEditor, 'getModel' | 'getSelection' | 'setSelection' | 'getRawOptions' | 'getContribution'>

type Insertion = { range: IRange; template: string; adjustWhitespace: boolean }

/** Where the starter goes and the snippet that goes there, or why it can't go in. Reads the file as it is now. */
function planInsertion(codeEditor: StarterEditor, kind: StarterFileKind, snippet: MermaidSnippet | null): Insertion | string {
    const model = codeEditor.getModel()
    if (!model) return STARTER_INSERT_PROBLEMS.noFile
    if (codeEditor.getRawOptions().readOnly) return STARTER_INSERT_PROBLEMS.readOnly
    if (kind === 'other') return STARTER_INSERT_PROBLEMS.otherFile
    const body = snippet?.body ?? ''
    if (kind === 'mermaid') {
        // A diagram file holds one diagram, so only an empty one (spaces and blank lines count as empty) takes it.
        if (model.getValue().trim() !== '') return STARTER_INSERT_PROBLEMS.diagramHasText
        // Like Ctrl+Space, the starter takes the file's own indentation (tabs or spaces).
        return { range: model.getFullModelRange(), template: body, adjustWhitespace: true }
    }
    // The caret counts as being at the end of the selection, which is kept.
    const selection = codeEditor.getSelection()
    const caretLine = (selection?.endLineNumber ?? 1) - 1
    const placement = placeFencedBlock((index) => model.getLineContent(index + 1), model.getLineCount(), caretLine)
    if (!placement) return STARTER_INSERT_PROBLEMS.inCodeBlock
    const lineNumber = placement.line + 1
    const lineEnd = model.getLineMaxColumn(lineNumber)
    const range = placement.replaceLine
        ? { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: lineEnd }
        : { startLineNumber: lineNumber, startColumn: lineEnd, endLineNumber: lineNumber, endColumn: lineEnd }
    // The snippet's line breaks become the file's own. Its text around the body has no `$`, `}` or `\` to escape.
    const template = `${'\n'.repeat(placement.breaksBefore)}\`\`\`mermaid\n${body}\n\`\`\`${'\n'.repeat(placement.breaksAfter)}`
    // Not indented to match the caret's line: the fence starts at the margin.
    return { range, template, adjustWhitespace: false }
}

/** Why a starter can't go in at the caret now, or null when it can. */
export function starterInsertProblem(codeEditor: StarterEditor, kind: StarterFileKind): string | null {
    const plan = planInsertion(codeEditor, kind, null)
    return typeof plan === 'string' ? plan : null
}

/**
 * Puts the starter in the editor as a snippet, so Tab moves through its placeholders, as one undo step. In a diagram
 * file it fills an empty file; in a Markdown file it goes in a ```mermaid block by the caret (see placeFencedBlock).
 * The checks run again first, as the file can change while the Diagram Starters window is open: when one fails
 * nothing changes and it returns why. Returns null once the starter is in. The editor should have focus.
 */
export function insertDiagramStarter(codeEditor: StarterEditor, kind: StarterFileKind, snippet: MermaidSnippet): string | null {
    const plan = planInsertion(codeEditor, kind, snippet)
    if (typeof plan === 'string') return plan
    const controller = codeEditor.getContribution<SnippetController & editor.IEditorContribution>('snippetController2')
    if (!controller) return "Couldn't insert the starter"
    // A starter typed with Ctrl+Space may still be in snippet mode: this one is a snippet of its own, not part of it.
    controller.cancel()
    const { range } = plan
    // The snippet takes the place of the selection: an empty one where the block goes, or the blank text there.
    codeEditor.setSelection({
        selectionStartLineNumber: range.startLineNumber,
        selectionStartColumn: range.startColumn,
        positionLineNumber: range.endLineNumber,
        positionColumn: range.endColumn,
    })
    controller.insert(plan.template, { adjustWhitespace: plan.adjustWhitespace, undoStopBefore: true, undoStopAfter: true })
    return null
}
