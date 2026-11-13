import { describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { buildEditorCommands, EDITOR_COMMAND_IDS, type EditorCommandsContext } from '@/components/studio/editor/editor-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

function context(overrides: Partial<EditorCommandsContext> = {}): EditorCommandsContext {
    return { editor: 'ready', readOnly: false, isMac: false, runAction: vi.fn(), ...overrides }
}

const find = (ctx: EditorCommandsContext, id: string) => buildEditorCommands(ctx).find((command) => command.id === id)
const shortcut = (ctx: EditorCommandsContext, id: string) => commandShortcut(find(ctx, id)!, createDefaultKeybinds(ctx.isMac), ctx.isMac)

describe('buildEditorCommands', () => {
    it("lists the Edit menu's commands in order, with the editor's own keys", () => {
        const ctx = context()
        expect(buildEditorCommands(ctx).map((c) => [c.label, commandShortcut(c, createDefaultKeybinds(false), false)])).toEqual([
            ['Undo', 'Ctrl+Z'],
            ['Redo', 'Ctrl+Y'],
            ['Cut', 'Ctrl+X'],
            ['Copy', 'Ctrl+C'],
            ['Paste', 'Ctrl+V'],
            ['Select All', 'Ctrl+A'],
            ['Find', 'Ctrl+F'],
            ['Replace', 'Ctrl+H'],
            ['Go to Line…', 'Ctrl+G'],
        ])
        expect(buildEditorCommands(ctx).map((c) => c.id)).toEqual(EDITOR_COMMAND_IDS)
    })

    it('uses the Mac keys on a Mac', () => {
        const mac = context({ isMac: true })
        expect(shortcut(mac, 'undo')).toBe('⌘Z')
        expect(shortcut(mac, 'redo')).toBe('⇧⌘Z')
        expect(shortcut(mac, 'replace')).toBe('⌥⌘F')
    })

    it("runs Monaco's own action for each", () => {
        const ctx = context()
        for (const id of EDITOR_COMMAND_IDS) void find(ctx, id)!.run()
        expect(vi.mocked(ctx.runAction).mock.calls.map(([action]) => action)).toEqual([
            'undo',
            'redo',
            'editor.action.clipboardCutAction',
            'editor.action.clipboardCopyAction',
            'editor.action.clipboardPasteAction',
            'editor.action.selectAll',
            'actions.find',
            'editor.action.startFindReplaceAction',
            'editor.action.gotoLine',
        ])
    })

    it('turns every command off when no file is open or the editor is hidden, and says why', () => {
        for (const [editor, reason] of [
            ['none', 'No file open'],
            ['hidden', 'The editor is hidden'],
        ] as const) {
            const commands = buildEditorCommands(context({ editor }))
            expect(commands.every((c) => c.disabled && c.disabledReason === reason)).toBe(true)
        }
    })

    it('turns off only the commands that change the text in a read-only file', () => {
        const commands = buildEditorCommands(context({ readOnly: true }))
        expect(commands.filter((c) => c.disabled).map((c) => c.id)).toEqual(['undo', 'redo', 'cut', 'paste', 'replace'])
        expect(find(context({ readOnly: true }), 'paste')?.disabledReason).toBe('This file is read-only')
    })
})
