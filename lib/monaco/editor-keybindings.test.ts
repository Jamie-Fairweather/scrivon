import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { CommandsRegistry } from 'monaco-editor/esm/vs/platform/commands/common/commands.js'
import { describe, expect, it, vi } from 'vitest'
import { bindEditorCommandPaletteToApp, MONACO_QUICK_COMMAND_ID } from './editor-keybindings'

const F1 = 59

/** An editor and a Monaco whose registerCommand is Monaco's real one, so "newest wins" is Monaco's own rule. */
function fakeEditorAndMonaco() {
    const addCommand = vi.fn()
    const editorInstance = { addCommand } as unknown as editor.IStandaloneCodeEditor
    const monaco = {
        KeyCode: { F1 },
        editor: { registerCommand: (id: string, handler: (accessor: unknown) => void) => CommandsRegistry.registerCommand(id, handler) },
    } as unknown as Monaco
    return { editorInstance, monaco, addCommand }
}

/** What the editor's right-click 'Command Palette' does: run the command by id from the shared registry. */
function runMenuEntry() {
    return CommandsRegistry.getCommand(MONACO_QUICK_COMMAND_ID)?.handler(undefined)
}

describe('bindEditorCommandPaletteToApp', () => {
    it("makes the right-click 'Command Palette' open the app palette instead of Monaco's list, until it is disposed", () => {
        // Monaco registers its own command list under this id when it loads.
        const openMonacoList = vi.fn()
        const monacoOwn = CommandsRegistry.registerCommand(MONACO_QUICK_COMMAND_ID, openMonacoList)
        const openPalette = vi.fn()
        const { editorInstance, monaco } = fakeEditorAndMonaco()

        const binding = bindEditorCommandPaletteToApp(editorInstance, monaco, openPalette)
        runMenuEntry()
        expect(openPalette).toHaveBeenCalledTimes(1)
        expect(openMonacoList).not.toHaveBeenCalled()

        // Once the editor is gone, nothing points at its palette any more.
        binding.dispose()
        runMenuEntry()
        expect(openPalette).toHaveBeenCalledTimes(1)
        monacoOwn.dispose()
    })

    it("leaves F1 to the app's keybinds, so a palette moved to another key doesn't also open on F1 in the editor", () => {
        const openPalette = vi.fn()
        const { editorInstance, monaco, addCommand } = fakeEditorAndMonaco()

        const binding = bindEditorCommandPaletteToApp(editorInstance, monaco, openPalette)
        expect(addCommand).toHaveBeenCalledWith(F1, expect.any(Function))
        addCommand.mock.calls[0]![1]()
        expect(openPalette).not.toHaveBeenCalled()
        binding.dispose()
    })
})
