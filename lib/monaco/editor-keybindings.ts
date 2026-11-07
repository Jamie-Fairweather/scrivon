import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, editor } from 'monaco-editor'

/** Monaco's own command list, which its right-click menu offers as 'Command Palette'. */
export const MONACO_QUICK_COMMAND_ID = 'editor.action.quickCommand'

/**
 * Makes the editor's right-click 'Command Palette' open Scrivon's palette instead of Monaco's own,
 * differently styled command list. The menu entry runs the command by id through Monaco's shared
 * command registry, where the newest registration wins, so the existing entry is reused and no
 * second one appears. (editor.addAction registers under an id of its own, which the entry never runs.)
 *
 * F1 does nothing inside the editor: the app's keybinds open the palette on whatever key the user
 * chose, and F1 may now belong to another action or to none. Dispose the result with the editor.
 */
export function bindEditorCommandPaletteToApp(editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco, openPalette: () => void): IDisposable {
    editorInstance.addCommand(monaco.KeyCode.F1, () => {
        // Intentionally empty: this binding is newer than Monaco's own F1, so it replaces it.
    })
    return monaco.editor.registerCommand(MONACO_QUICK_COMMAND_ID, () => openPalette())
}
