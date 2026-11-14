import type { Monaco } from '@monaco-editor/react'
import type { IRange, editor } from 'monaco-editor'
import { toggleInlineStyle, toggleLink, type InlineStyle, type TextRange } from '@/lib/markdown/inline-format'
import { listEnter } from '@/lib/markdown/list-continuation'

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
