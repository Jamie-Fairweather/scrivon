// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IDisposable } from 'monaco-editor'
// Monaco's real clipboard commands: registers its Paste, as loading the editor does.
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import { InMemoryClipboardMetadataManager } from 'monaco-editor/editor/browser/controller/editContext/clipboardUtils.js'
import { EditorExtensionsRegistry } from 'monaco-editor/editor/browser/editorExtensions.js'
import { CommandsRegistry } from 'monaco-editor/platform/commands/common/commands.js'
import { MONACO_PASTE_COMMAND_ID, takeOverEditorPaste } from './paste-command'

const clipboard = vi.hoisted(() => ({ readText: vi.fn<() => Promise<string>>() }))
const notify = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/tauri/clipboard', () => ({ readClipboardText: clipboard.readText }))
vi.mock('@/lib/notify', () => ({ notifyError: notify.error }))

/** Runs Monaco's Paste by id, as Edit > Paste, the palette and the right-click menu do. */
const choosePaste = () => CommandsRegistry.getCommand(MONACO_PASTE_COMMAND_ID)?.handler({}, {})

describe("Monaco's Paste", () => {
    it('is a plain command, so editor.trigger from the menus reaches the one Scrivon registers', () => {
        // editor.trigger runs an editor action or editor command of that id first, and only then the shared registry.
        expect(CommandsRegistry.getCommand(MONACO_PASTE_COMMAND_ID)).toBeDefined()
        expect(EditorExtensionsRegistry.getEditorActions().map(({ id }) => id)).not.toContain(MONACO_PASTE_COMMAND_ID)
        expect(EditorExtensionsRegistry.getEditorCommand(MONACO_PASTE_COMMAND_ID)).toBeNull()
    })
})

describe('takeOverEditorPaste', () => {
    /** Monaco's own Paste, which reads the clipboard through the browser and so makes WebView2 ask for access. */
    const monacoPaste = vi.fn()
    const pastePicture = vi.fn(async () => {})
    let monacoOwn: IDisposable
    let taken: IDisposable
    const editor = { textFocused: true, hasTextFocus: () => editor.textFocused, trigger: vi.fn() }

    beforeEach(() => {
        vi.clearAllMocks()
        editor.textFocused = true
        monacoOwn = CommandsRegistry.registerCommand(MONACO_PASTE_COMMAND_ID, monacoPaste)
        taken = takeOverEditorPaste(editor, pastePicture)
    })

    afterEach(() => {
        taken.dispose()
        monacoOwn.dispose()
    })

    it('pastes the clipboard’s text the way Ctrl+V does, without Monaco’s own clipboard read', async () => {
        clipboard.readText.mockResolvedValue('Hello')

        await choosePaste()

        // Monaco's paste handler, as Ctrl+V uses: one step to undo, and the cursors move past the text.
        expect(editor.trigger).toHaveBeenCalledWith('keyboard', 'paste', { text: 'Hello', pasteOnNewLine: false, multicursorText: null, mode: null })
        expect(monacoPaste).not.toHaveBeenCalled()
        expect(pastePicture).not.toHaveBeenCalled()
    })

    it('gives each cursor its own line when the text was copied from as many cursors, and a whole copied line a line of its own', async () => {
        // What the editor notes when it copies, as Ctrl+V finds it.
        InMemoryClipboardMetadataManager.INSTANCE.set('one\r\ntwo', {
            isFromEmptySelection: false,
            multicursorText: ['one', 'two'],
            mode: 'markdown',
        })
        clipboard.readText.mockResolvedValue('one\r\ntwo')
        await choosePaste()
        expect(editor.trigger).toHaveBeenLastCalledWith('keyboard', 'paste', {
            text: 'one\r\ntwo',
            pasteOnNewLine: false,
            multicursorText: ['one', 'two'],
            mode: 'markdown',
        })

        InMemoryClipboardMetadataManager.INSTANCE.set('# Setup\r\n', { isFromEmptySelection: true, multicursorText: null, mode: null })
        clipboard.readText.mockResolvedValue('# Setup\r\n')
        await choosePaste()
        expect(editor.trigger).toHaveBeenLastCalledWith('keyboard', 'paste', {
            text: '# Setup\r\n',
            pasteOnNewLine: true,
            multicursorText: null,
            mode: null,
        })
    })

    it('pastes the picture when the clipboard has no text', async () => {
        clipboard.readText.mockResolvedValue('')

        await choosePaste()

        expect(pastePicture).toHaveBeenCalledTimes(1)
        expect(editor.trigger).not.toHaveBeenCalled()
        expect(monacoPaste).not.toHaveBeenCalled()
    })

    it('leaves the clipboard alone when the editor’s text doesn’t have focus (its find box does)', async () => {
        editor.textFocused = false

        await choosePaste()

        expect(clipboard.readText).not.toHaveBeenCalled()
        expect(monacoPaste).not.toHaveBeenCalled()
    })

    it('says why when the clipboard can’t be read', async () => {
        clipboard.readText.mockRejectedValueOnce('The native clipboard is not accessible due to being held by another party.')
        await choosePaste()
        expect(notify.error).toHaveBeenCalledWith("Couldn't paste", 'The native clipboard is not accessible due to being held by another party.')

        clipboard.readText.mockResolvedValue('')
        pastePicture.mockRejectedValueOnce('failed to read clipboard PNG data')
        await choosePaste()
        expect(notify.error).toHaveBeenLastCalledWith("Couldn't paste", 'failed to read clipboard PNG data')
        expect(monacoPaste).not.toHaveBeenCalled()
    })

    it('gives Paste back to Monaco once disposed', () => {
        taken.dispose()

        choosePaste()

        expect(clipboard.readText).not.toHaveBeenCalled()
        expect(monacoPaste).toHaveBeenCalledTimes(1)
    })
})
