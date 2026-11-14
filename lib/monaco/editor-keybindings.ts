import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

/**
 * F1 does nothing inside the editor, where Monaco would open its own, differently styled command list.
 * The app's keybinds open Scrivon's palette on whatever key the user chose, and F1 may now belong to
 * another action or to none.
 */
export function leaveF1ToAppKeybinds(editorInstance: Pick<editor.IStandaloneCodeEditor, 'addCommand'>, monaco: Pick<Monaco, 'KeyCode'>): void {
    editorInstance.addCommand(monaco.KeyCode.F1, () => {
        // Intentionally empty: this binding is newer than Monaco's own F1, so it replaces it.
    })
}
