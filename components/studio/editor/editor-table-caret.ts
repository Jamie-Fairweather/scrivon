import type { IDisposable, editor } from 'monaco-editor'
import { isLineInTable } from '@/lib/markdown/markdown-table'

export type TableCaretSource = Pick<editor.ICodeEditor, 'getModel' | 'getPosition' | 'onDidChangeCursorPosition' | 'onDidChangeModel'>

/**
 * Says whether the caret is in a Markdown table, for the table commands, each time the caret moves or
 * another file shows. `onChange` runs only when the answer changes. It has to stay cheap on every caret
 * move (#189): a caret line with no `|` is the only line it reads, and in a table it reads only the
 * table and the line each side. It never looks for code blocks; the commands do that when they run.
 */
export function trackCaretInTable(source: TableCaretSource, isMarkdown: () => boolean, onChange: (inTable: boolean) => void): IDisposable {
    let last = false
    const update = () => {
        const model = source.getModel()
        const position = source.getPosition()
        const inTable =
            model !== null &&
            position !== null &&
            isMarkdown() &&
            isLineInTable((index) => model.getLineContent(index + 1), model.getLineCount(), position.lineNumber - 1)
        if (inTable === last) return
        last = inTable
        onChange(inTable)
    }
    const subscriptions = [source.onDidChangeCursorPosition(update), source.onDidChangeModel(update)]
    update()
    return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) }
}
