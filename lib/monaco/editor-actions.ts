import type { editor } from 'monaco-editor'

/**
 * Runs one of Monaco's own actions (undo, the clipboard, find, go to line) as if it were chosen in the
 * editor. Those act on the focused editor, so it takes focus first. A frame later, so the menu or the
 * palette the user picked it from has closed and let go of focus.
 */
export function runEditorAction(codeEditor: Pick<editor.ICodeEditor, 'focus' | 'trigger' | 'getModel'>, actionId: string): void {
    requestAnimationFrame(() => {
        // The file may have closed meanwhile.
        if (!codeEditor.getModel()) return
        codeEditor.focus()
        codeEditor.trigger('scrivon', actionId, null)
    })
}
