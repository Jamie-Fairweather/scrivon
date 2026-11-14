import type { IDisposable, editor } from 'monaco-editor'
import { CommandsRegistry } from 'monaco-editor/platform/commands/common/commands.js'

/** Monaco's Paste. Edit > Paste, the palette's Paste and the editor's right-click Paste run it; Ctrl+V doesn't (the browser pastes). */
export const MONACO_PASTE_COMMAND_ID = 'editor.action.clipboardPasteAction'

/** True for the re-run marked to go straight to Monaco's paste. Monaco's paste ignores what it's given. */
function isPassOn(payload: unknown): boolean {
    return typeof payload === 'object' && payload !== null && 'scrivonPassOn' in payload && payload.scrivonPassOn === true
}

/**
 * Lets `pasteFirst` have Monaco's Paste command before Monaco does. In a web view Monaco's Paste reads only the
 * clipboard's text (no paste event fires), so a copied picture never arrives. `pasteFirst` returns null to let
 * Monaco paste at once, or a promise of whether it pasted, which never rejects. When it didn't paste, Monaco does.
 *
 * The command is shared by every editor, and the newest registration wins (as in editor-keybindings.ts), so the
 * menus pick this one up. Dispose with the editor.
 */
export function takeOverEditorPaste(editor: Pick<editor.ICodeEditor, 'trigger'>, pasteFirst: () => Promise<boolean> | null): IDisposable {
    const monacoPaste = CommandsRegistry.getCommand(MONACO_PASTE_COMMAND_ID)
    return CommandsRegistry.registerCommand(MONACO_PASTE_COMMAND_ID, (accessor, ...args) => {
        const pasting = isPassOn(args[0]) ? null : pasteFirst()
        if (!pasting) return monacoPaste?.handler(accessor, ...args)
        return pasting.then((pasted) => {
            // Monaco's paste needs the editor's services, which are only to hand while a command runs: run it again,
            // marked so it goes straight to Monaco however late it arrives.
            if (!pasted) editor.trigger('scrivon', MONACO_PASTE_COMMAND_ID, { scrivonPassOn: true })
        })
    })
}
