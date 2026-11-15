import { describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { buildEditorCommands, type EditorCommandsContext } from '@/components/studio/editor/editor-commands'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

function context(overrides: Partial<EditorCommandsContext> = {}): EditorCommandsContext {
    return { editor: 'ready', readOnly: false, markdown: true, isMac: false, runAction: vi.fn(), runFormat: vi.fn(), ...overrides }
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
            ['Bold', 'Ctrl+B'],
            ['Italic', 'Ctrl+I'],
            ['Inline Code', 'Ctrl+E'],
            ['Link', 'Ctrl+K'],
        ])
        // Prefixed, so another feature's 'copy' or 'go-to-line' can't push these out of the shared list.
        expect(buildEditorCommands(ctx).every((c) => c.id.startsWith('edit.'))).toBe(true)
    })

    it('uses the Mac keys on a Mac', () => {
        const mac = context({ isMac: true })
        expect(shortcut(mac, 'edit.undo')).toBe('⌘Z')
        expect(shortcut(mac, 'edit.redo')).toBe('⇧⌘Z')
        expect(shortcut(mac, 'edit.replace')).toBe('⌥⌘F')
        expect(shortcut(mac, 'edit.bold')).toBe('⌘B')
    })

    it("runs Monaco's own action for each, and the Markdown helpers for the formats", () => {
        const ctx = context()
        for (const command of buildEditorCommands(ctx)) void command.run()
        expect(vi.mocked(ctx.runFormat).mock.calls.map(([format]) => format)).toEqual(['bold', 'italic', 'code', 'link'])
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
        expect(commands.filter((c) => c.disabled).map((c) => c.id)).toEqual([
            'edit.undo',
            'edit.redo',
            'edit.cut',
            'edit.paste',
            'edit.replace',
            'edit.bold',
            'edit.italic',
            'edit.inline-code',
            'edit.link',
        ])
        expect(find(context({ readOnly: true }), 'edit.paste')?.disabledReason).toBe('This file is read-only')
        expect(find(context({ readOnly: true }), 'edit.link')?.disabledReason).toBe('This file is read-only')
    })

    it('turns the Markdown helpers off in other files, so their keys do what they do there', () => {
        const commands = buildEditorCommands(context({ markdown: false }))
        expect(commands.filter((c) => c.disabled).map((c) => [c.id, c.disabledReason])).toEqual([
            ['edit.bold', 'Only in Markdown files'],
            ['edit.italic', 'Only in Markdown files'],
            ['edit.inline-code', 'Only in Markdown files'],
            ['edit.link', 'Only in Markdown files'],
        ])
    })
})
