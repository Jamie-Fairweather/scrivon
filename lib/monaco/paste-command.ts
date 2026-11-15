import type { IDisposable, editor } from 'monaco-editor'
import { InMemoryClipboardMetadataManager } from 'monaco-editor/editor/browser/controller/editContext/clipboardUtils.js'
import { CommandsRegistry } from 'monaco-editor/platform/commands/common/commands.js'
import { notifyError } from '@/lib/notify'
import { readClipboardText } from '@/lib/tauri/clipboard'

/** Monaco's Paste. Edit > Paste, the palette's Paste and the editor's right-click Paste run it; Ctrl+V doesn't (the browser pastes). */
export const MONACO_PASTE_COMMAND_ID = 'editor.action.clipboardPasteAction'

/** The editor calls Paste makes. */
export type PasteEditor = Pick<editor.ICodeEditor, 'hasTextFocus' | 'trigger'>

/** Pastes `text` with Monaco's paste handler, the one Ctrl+V uses, so it undoes in one step like a typed paste. */
function pasteText(editor: PasteEditor, text: string): void {
    // What the editor noted when it copied this text: from several cursors (one line each when pasted into as
    // many), or a whole line copied with nothing selected (pasted on a line of its own).
    const copied = InMemoryClipboardMetadataManager.INSTANCE.get(text)
    editor.trigger('keyboard', 'paste', {
        text,
        pasteOnNewLine: copied?.isFromEmptySelection === true,
        multicursorText: copied?.multicursorText ?? null,
        mode: copied?.mode ?? null,
    })
}

/** Pastes the clipboard's text, or `pastePicture` when it has none. Never rejects: a failure is shown instead. */
async function pasteFromClipboard(editor: PasteEditor, pastePicture: () => Promise<void>): Promise<void> {
    // As Monaco's own Paste: into the text only, not into the find box.
    if (!editor.hasTextFocus()) return
    try {
        const text = await readClipboardText()
        // Text wins, as with Ctrl+V: Word and web pages put a picture of copied text alongside it.
        if (text !== '') pasteText(editor, text)
        else await pastePicture()
    } catch (error) {
        notifyError("Couldn't paste", error)
    }
}

/**
 * Replaces Monaco's Paste command for `editor`. Monaco's own reads the clipboard through the browser, which makes
 * WebView2 ask the user for clipboard access (#208); this reads it through Tauri (lib/tauri/clipboard.ts) and
 * pastes the text, or, when there is none, has `pastePicture` paste the picture there.
 *
 * The command is shared by every editor, and the newest registration wins (as in editor-keybindings.ts), so the
 * menus pick this one up. Dispose with the editor.
 */
export function takeOverEditorPaste(editor: PasteEditor, pastePicture: () => Promise<void>): IDisposable {
    return CommandsRegistry.registerCommand(MONACO_PASTE_COMMAND_ID, () => pasteFromClipboard(editor, pastePicture))
}
