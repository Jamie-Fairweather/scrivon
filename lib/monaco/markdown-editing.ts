import type { Monaco } from '@monaco-editor/react'
import type { IRange, editor } from 'monaco-editor'
import { toggleInlineStyle, toggleLink, type InlineStyle, type TextRange } from '@/lib/markdown/inline-format'
import { listEnter } from '@/lib/markdown/list-continuation'
import {
    editTable,
    insertTable,
    tableInsertProblem,
    type LinesEdit,
    type TableAction,
    type TableSize,
    type TextCaret,
} from '@/lib/markdown/markdown-table'
import { notifyInfo } from '@/lib/notify'

/** The Markdown writing helpers: each toggles (lib/markdown/inline-format.ts). */
export type MarkdownFormat = InlineStyle | 'link'

const EDIT_SOURCE = 'scrivon.markdown'

/** Makes the selections bold, italic, inline code or a link, or takes that off again, as one undo step. */
export function formatMarkdown(codeEditor: editor.ICodeEditor, format: MarkdownFormat): void {
    const model = codeEditor.getModel()
    if (!model) return
    const selections: TextRange[] = (codeEditor.getSelections() ?? []).map((selection) => ({
        start: model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
        end: model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn }),
    }))
    const text = model.getValue()
    const result = format === 'link' ? toggleLink(text, selections) : toggleInlineStyle(text, selections, format)
    if (result.edits.length === 0) return

    const rangeOf = (start: number, end: number): IRange => {
        const from = model.getPositionAt(start)
        const to = model.getPositionAt(end)
        return { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }
    }
    codeEditor.pushUndoStop()
    codeEditor.executeEdits(
        EDIT_SOURCE,
        result.edits.map((edit) => ({ range: rangeOf(edit.start, edit.end), text: edit.text }))
    )
    // Read from the changed text.
    codeEditor.setSelections(
        result.selections.map(({ start, end }) => {
            const range = rangeOf(start, end)
            return {
                selectionStartLineNumber: range.startLineNumber,
                selectionStartColumn: range.startColumn,
                positionLineNumber: range.endLineNumber,
                positionColumn: range.endColumn,
            }
        })
    )
    codeEditor.pushUndoStop()
}

// The table helpers' notices replace each other rather than stacking up.
const TABLE_NOTICE_ID = 'markdown-table'

const TABLE_NOTICES = {
    'no-table': 'Put the caret in a table',
    'code-block': 'Tables in a code block are left as they are',
    'in-table': 'The caret is already in a table',
    'insert-code-block': "A table can't go inside a code block",
    'read-only': 'This file is read-only',
} as const

function tableNotice(notice: keyof typeof TABLE_NOTICES): void {
    notifyInfo(TABLE_NOTICES[notice], { id: TABLE_NOTICE_ID })
}

/** The file's lines (from 0) and the primary caret, for the table helpers, or null without a file or in a read-only one. */
function tableContext(codeEditor: editor.ICodeEditor): { model: editor.ITextModel; lineAt: (index: number) => string; caret: TextCaret } | null {
    const model = codeEditor.getModel()
    const position = codeEditor.getPosition()
    if (!model || !position) return null
    if (codeEditor.getRawOptions().readOnly) {
        tableNotice('read-only')
        return null
    }
    return { model, lineAt: (index) => model.getLineContent(index + 1), caret: { line: position.lineNumber - 1, column: position.column - 1 } }
}

/**
 * Replaces whole lines as one undo step, then leaves a single caret where it says (other carets and any
 * selection go). The lines are joined with the file's own line ending.
 */
function applyLinesEdit(codeEditor: editor.ICodeEditor, model: editor.ITextModel, edit: LinesEdit, caret: TextCaret): void {
    const eol = model.getEOL()
    const lineCount = model.getLineCount()
    const lineEnd = (lineNumber: number) => model.getLineMaxColumn(lineNumber)
    const text = edit.lines.join(eol)
    let range: IRange
    let replacement = text
    if (edit.end > edit.start && edit.lines.length > 0) {
        range = { startLineNumber: edit.start + 1, startColumn: 1, endLineNumber: edit.end, endColumn: lineEnd(edit.end) }
    } else if (edit.end > edit.start) {
        // Deleting lines takes a line break with them: the one after, or before the last line.
        range =
            edit.end < lineCount
                ? { startLineNumber: edit.start + 1, startColumn: 1, endLineNumber: edit.end + 1, endColumn: 1 }
                : edit.start > 0
                  ? { startLineNumber: edit.start, startColumn: lineEnd(edit.start), endLineNumber: edit.end, endColumn: lineEnd(edit.end) }
                  : { startLineNumber: 1, startColumn: 1, endLineNumber: edit.end, endColumn: lineEnd(edit.end) }
    } else if (edit.start < lineCount) {
        range = { startLineNumber: edit.start + 1, startColumn: 1, endLineNumber: edit.start + 1, endColumn: 1 }
        replacement = text + eol
    } else {
        range = { startLineNumber: lineCount, startColumn: lineEnd(lineCount), endLineNumber: lineCount, endColumn: lineEnd(lineCount) }
        replacement = eol + text
    }
    codeEditor.pushUndoStop()
    codeEditor.executeEdits(EDIT_SOURCE, [{ range, text: replacement }])
    const lineNumber = caret.line + 1
    const column = caret.column + 1
    codeEditor.setSelections([
        { selectionStartLineNumber: lineNumber, selectionStartColumn: column, positionLineNumber: lineNumber, positionColumn: column },
    ])
    codeEditor.pushUndoStop()
}

/**
 * Runs a table command (lib/markdown/markdown-table.ts) on the table at the primary caret, as one undo
 * step. It finds the table again, as the editor's idea of where the caret is can be a moment old. Outside
 * a table, or in one in a code block, nothing changes and a notice says why; a command that can't apply
 * (moving the header row…) or a table that's already tidy changes nothing either.
 */
export function editMarkdownTable(codeEditor: editor.ICodeEditor, action: TableAction): void {
    const context = tableContext(codeEditor)
    if (!context) return
    const { model, lineAt, caret } = context
    const result = editTable(lineAt, model.getLineCount(), caret, action)
    if (result.status === 'no-table' || result.status === 'code-block') tableNotice(result.status)
    if (result.status !== 'edited') return
    applyLinesEdit(codeEditor, model, result.edit, result.caret)
}

/** Whether a new table can go in at the primary caret. When it can't, a notice says why. */
export function canInsertMarkdownTable(codeEditor: editor.ICodeEditor): boolean {
    const context = tableContext(codeEditor)
    if (!context) return false
    const problem = tableInsertProblem(context.lineAt, context.model.getLineCount(), context.caret)
    if (problem) tableNotice(problem === 'in-table' ? 'in-table' : 'insert-code-block')
    return problem === null
}

/** Inserts an empty table at the primary caret as one undo step, with the caret in its first header cell. */
export function insertMarkdownTable(codeEditor: editor.ICodeEditor, size: TableSize): void {
    const context = tableContext(codeEditor)
    if (!context) return
    const { model, lineAt, caret } = context
    const result = insertTable(lineAt, model.getLineCount(), caret, size)
    if (result.status !== 'edited') {
        tableNotice(result.status === 'in-table' ? 'in-table' : 'insert-code-block')
        return
    }
    applyLinesEdit(codeEditor, model, result.edit, result.caret)
}

/** Continues or ends the list at the caret, as one undo step. False when Enter should just type a new line. */
function enterInList(codeEditor: editor.ICodeEditor): boolean {
    const model = codeEditor.getModel()
    const selections = codeEditor.getSelections() ?? []
    const [caret] = selections
    if (!model || selections.length !== 1 || !caret) return false
    if (caret.startLineNumber !== caret.endLineNumber || caret.startColumn !== caret.endColumn) return false

    const lineNumber = caret.startLineNumber
    const edit = listEnter((index) => model.getLineContent(index + 1), lineNumber - 1, caret.startColumn - 1)
    if (!edit) return false

    codeEditor.pushUndoStop()
    codeEditor.executeEdits(EDIT_SOURCE, [
        { range: { startLineNumber: lineNumber, startColumn: edit.from + 1, endLineNumber: lineNumber, endColumn: edit.to + 1 }, text: edit.text },
    ])
    // Worked out from the lines, as the file may use \r\n where the edit says \n.
    const added = edit.text.split('\n')
    const line = lineNumber + added.length - 1
    const column = added.length === 1 ? edit.from + edit.text.length + 1 : added[added.length - 1].length + 1
    codeEditor.setSelections([{ selectionStartLineNumber: line, selectionStartColumn: column, positionLineNumber: line, positionColumn: column }])
    codeEditor.pushUndoStop()
    return true
}

/**
 * Enter in a Markdown list continues it (bullets, numbers, task boxes), and Enter on an empty item
 * ends it. Anywhere else, and in other files, Enter types a new line as usual. Lasts as long as the editor.
 */
export function bindMarkdownListEnter(codeEditor: editor.IStandaloneCodeEditor, monaco: Monaco, isMarkdown: () => boolean): void {
    codeEditor.addCommand(
        monaco.KeyCode.Enter,
        () => {
            if (isMarkdown() && enterInList(codeEditor)) return
            codeEditor.trigger('keyboard', 'type', { text: '\n' })
        },
        // Not in the find box, a read-only file, or while a suggestion list (Enter picks from it) is open.
        'editorTextFocus && !editorReadonly && !suggestWidgetVisible'
    )
}
