import type { editor } from 'monaco-editor'

/** Returns the active editor selection text, or null when empty or unavailable. */
export function readEditorSelectedText(editorInstance: editor.IStandaloneCodeEditor | null): string | null {
    if (!editorInstance) return null

    const model = editorInstance.getModel()
    const selection = editorInstance.getSelection()
    if (!model || !selection || selection.isEmpty()) return null

    const text = model.getValueInRange(selection)
    const trimmed = text.trim()
    return trimmed.length > 0 ? text : null
}
