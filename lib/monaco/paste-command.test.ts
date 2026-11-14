// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IDisposable } from 'monaco-editor'
// Monaco's real clipboard commands: registers its Paste, as loading the editor does.
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import { EditorExtensionsRegistry } from 'monaco-editor/editor/browser/editorExtensions.js'
import { CommandsRegistry } from 'monaco-editor/platform/commands/common/commands.js'
import { MONACO_PASTE_COMMAND_ID, takeOverEditorPaste } from './paste-command'

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
    const monacoPaste = vi.fn()
    let monacoOwn: IDisposable
    const taken: IDisposable[] = []

    /** An editor whose trigger runs the command a little later, as a future Monaco might. */
    const lateEditor = {
        trigger: vi.fn((_source: string, id: string, payload: unknown) => {
            setTimeout(() => CommandsRegistry.getCommand(id)?.handler({}, payload))
        }),
    }

    const takeOver = (pasteFirst: () => Promise<boolean> | null) => {
        const disposable = takeOverEditorPaste(lateEditor, pasteFirst)
        taken.push(disposable)
        return disposable
    }

    beforeEach(() => {
        vi.clearAllMocks()
        monacoOwn = CommandsRegistry.registerCommand(MONACO_PASTE_COMMAND_ID, monacoPaste)
    })

    afterEach(() => {
        taken.splice(0).forEach((disposable) => disposable.dispose())
        monacoOwn.dispose()
    })

    it('leaves Monaco out when Scrivon pasted', async () => {
        const pasteFirst = vi.fn(async () => true)
        takeOver(pasteFirst)

        await choosePaste()

        expect(pasteFirst).toHaveBeenCalledTimes(1)
        expect(lateEditor.trigger).not.toHaveBeenCalled()
        expect(monacoPaste).not.toHaveBeenCalled()
    })

    it('lets Monaco paste at once when Scrivon has nothing to try', () => {
        takeOver(() => null)

        choosePaste()

        expect(monacoPaste).toHaveBeenCalledTimes(1)
    })

    it('hands Paste to Monaco just once when Scrivon didn’t paste, however late the re-run arrives', async () => {
        const pasteFirst = vi.fn(async () => false)
        takeOver(pasteFirst)

        await choosePaste()
        await vi.waitFor(() => expect(monacoPaste).toHaveBeenCalledTimes(1))
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(pasteFirst).toHaveBeenCalledTimes(1)
        expect(monacoPaste).toHaveBeenCalledTimes(1)
    })

    it('passes the re-run through an older editor’s takeover without asking it again', async () => {
        const older = vi.fn(async () => false)
        const newer = vi.fn(async () => false)
        takeOver(older)
        takeOver(newer)

        await choosePaste()
        await vi.waitFor(() => expect(monacoPaste).toHaveBeenCalledTimes(1))

        expect(newer).toHaveBeenCalledTimes(1)
        expect(older).not.toHaveBeenCalled()
    })

    it('gives Paste back to Monaco once disposed', () => {
        const pasteFirst = vi.fn(async () => true)
        takeOver(pasteFirst).dispose()

        choosePaste()

        expect(pasteFirst).not.toHaveBeenCalled()
        expect(monacoPaste).toHaveBeenCalledTimes(1)
    })
})
