import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

/** Override Monaco's default F1 command palette; Scrivon uses the app palette on F1. */
export function unbindEditorF1Command(editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco): void {
    editorInstance.addCommand(monaco.KeyCode.F1, () => {
        // Intentionally empty — higher-priority dynamic binding replaces editor.action.quickCommand.
    })
}
