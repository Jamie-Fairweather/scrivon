// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import type { editor } from 'monaco-editor'
import { describe, expect, it, vi } from 'vitest'
import { commandShortcut, type AppCommand } from '@/components/studio/commands/app-command'
import { buildEditorCommands, useEditorCommands, type EditorCommandsContext } from '@/components/studio/editor/editor-commands'
import type { TableSize } from '@/lib/markdown/markdown-table'
import { canInsertMarkdownTable, editMarkdownTable, insertMarkdownTable } from '@/lib/monaco/markdown-editing'
import { findKeybindConflicts } from '@/lib/settings/conflicts'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

vi.mock('@/lib/monaco/markdown-editing', () => ({
    formatMarkdown: vi.fn(),
    editMarkdownTable: vi.fn(),
    canInsertMarkdownTable: vi.fn(() => true),
    insertMarkdownTable: vi.fn(),
}))
// The commands useEditorCommands registers, last time round.
const registered = vi.hoisted(() => ({ current: [] as readonly AppCommand[] }))
vi.mock('@/components/studio/commands/command-registry', () => ({
    useRegisterCommands: (commands: readonly AppCommand[]) => {
        registered.current = commands
    },
}))

function context(overrides: Partial<EditorCommandsContext> = {}): EditorCommandsContext {
    return {
        editor: 'ready',
        readOnly: false,
        markdown: true,
        isMac: false,
        runAction: vi.fn(),
        runFormat: vi.fn(),
        inTable: false,
        runTable: vi.fn(),
        insertTable: vi.fn(),
        ...overrides,
    }
}

const TABLE_IDS = [
    'edit.table.insert-row-above',
    'edit.table.insert-row-below',
    'edit.table.delete-row',
    'edit.table.move-row-up',
    'edit.table.move-row-down',
    'edit.table.insert-column-left',
    'edit.table.insert-column-right',
    'edit.table.delete-column',
    'edit.table.move-column-left',
    'edit.table.move-column-right',
    'edit.table.align-left',
    'edit.table.align-center',
    'edit.table.align-right',
    'edit.table.align-none',
    'edit.table.format',
]

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
            ['Insert Table…', undefined],
            ['Table: Insert Row Above', undefined],
            ['Table: Insert Row Below', undefined],
            ['Table: Delete Row', undefined],
            ['Table: Move Row Up', undefined],
            ['Table: Move Row Down', undefined],
            ['Table: Insert Column Left', undefined],
            ['Table: Insert Column Right', undefined],
            ['Table: Delete Column', undefined],
            ['Table: Move Column Left', undefined],
            ['Table: Move Column Right', undefined],
            ['Table: Align Column Left', undefined],
            ['Table: Align Column Centre', undefined],
            ['Table: Align Column Right', undefined],
            ['Table: Align Column None', undefined],
            ['Format Table', 'Alt+Shift+F'],
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
            'edit.table.insert',
            ...TABLE_IDS,
        ])
        expect(find(context({ readOnly: true }), 'edit.paste')?.disabledReason).toBe('This file is read-only')
        expect(find(context({ readOnly: true }), 'edit.link')?.disabledReason).toBe('This file is read-only')
        expect(find(context({ readOnly: true, inTable: true }), 'edit.table.format')?.disabledReason).toBe('This file is read-only')
        expect(find(context({ readOnly: true }), 'edit.table.insert')?.disabledReason).toBe('This file is read-only')
    })

    it('turns the Markdown helpers off in other files, so their keys do what they do there', () => {
        const commands = buildEditorCommands(context({ markdown: false }))
        expect(commands.filter((c) => c.disabled).map((c) => [c.id, c.disabledReason])).toEqual(
            ['edit.bold', 'edit.italic', 'edit.inline-code', 'edit.link', 'edit.table.insert', ...TABLE_IDS].map((id) => [
                id,
                'Only in Markdown files',
            ])
        )
    })
})

describe('buildEditorCommands table helpers', () => {
    it('names "table" in every one’s keywords, with ids starting edit.table.', () => {
        const table = buildEditorCommands(context()).filter((c) => c.id.startsWith('edit.table.'))
        expect(table.map((c) => c.id)).toEqual(['edit.table.insert', ...TABLE_IDS])
        expect(table.every((c) => c.keywords?.split(' ').includes('table'))).toBe(true)
    })

    it('runs each table command on the table at the caret', () => {
        const ctx = context({ inTable: true })
        for (const command of buildEditorCommands(ctx).filter((c) => c.id.startsWith('edit.table.'))) void command.run()
        expect(ctx.insertTable).toHaveBeenCalledTimes(1)
        expect(vi.mocked(ctx.runTable).mock.calls.map(([action]) => action)).toEqual([
            'insert-row-above',
            'insert-row-below',
            'delete-row',
            'move-row-up',
            'move-row-down',
            'insert-column-left',
            'insert-column-right',
            'delete-column',
            'move-column-left',
            'move-column-right',
            'align-left',
            'align-center',
            'align-right',
            'align-none',
            'format',
        ])
    })

    it('turns the row, column, alignment and Format Table commands off outside a table, and Insert Table off in one', () => {
        const outside = buildEditorCommands(context({ inTable: false }))
        expect(outside.filter((c) => c.disabled).map((c) => [c.id, c.disabledReason])).toEqual(
            TABLE_IDS.map((id) => [id, 'Put the caret in a table'])
        )

        const inside = buildEditorCommands(context({ inTable: true }))
        expect(inside.filter((c) => c.disabled).map((c) => [c.id, c.disabledReason])).toEqual([
            ['edit.table.insert', 'The caret is already in a table'],
        ])
    })

    it('gives keys only to Insert Table (none by default) and Format Table (Shift+Alt+F)', () => {
        const withKeys = buildEditorCommands(context()).filter((c) => c.id.startsWith('edit.table.') && (c.keybind || c.keys))
        expect(withKeys.map((c) => [c.id, c.keybind])).toEqual([
            ['edit.table.insert', 'format.insertTable'],
            ['edit.table.format', 'format.table'],
        ])
        expect(shortcut(context(), 'edit.table.insert')).toBeUndefined()
        expect(shortcut(context({ isMac: true }), 'edit.table.format')).toBe('⌥⇧F')
    })

    it('keeps Shift+Alt+F for Format Table in a Markdown file, even outside a table, and lets it reach the editor in other files', () => {
        expect(find(context({ inTable: false }), 'edit.table.format')).toMatchObject({ disabled: true, keepsKeysWhenOff: true })
        expect(find(context({ readOnly: true }), 'edit.table.format')).toMatchObject({ disabled: true, keepsKeysWhenOff: true })
        expect(find(context({ markdown: false }), 'edit.table.format')).toMatchObject({ disabled: true, keepsKeysWhenOff: false })
        expect(find(context({ markdown: false }), 'edit.table.insert')).toMatchObject({ disabled: true, keepsKeysWhenOff: false })
    })

    it('has no key clash in the default keys, Shift+Alt+F included', () => {
        expect(findKeybindConflicts(createDefaultKeybinds(false))).toEqual([])
        expect(findKeybindConflicts(createDefaultKeybinds(true))).toEqual([])
    })
})

describe('useEditorCommands table helpers', () => {
    /** The editor's commands for a Markdown file, run from a shortcut typed in the editor (so at once). */
    function setUp(askTableSize: () => Promise<TableSize | null>, inTable = false) {
        const model = {}
        const codeEditor = { getModel: vi.fn(() => model), focus: vi.fn(), hasTextFocus: () => true }
        renderHook(() =>
            useEditorCommands(codeEditor as unknown as editor.ICodeEditor, { shown: true, readOnly: false, markdown: true, inTable, askTableSize })
        )
        const run = (id: string) => act(() => void registered.current.find((command) => command.id === id)!.run())
        return { codeEditor, run }
    }

    it('asks for the size, then inserts the table in the editor', async () => {
        const { codeEditor, run } = setUp(async () => ({ columns: 4, rows: 3 }))

        run('edit.table.insert')

        await waitFor(() => expect(insertMarkdownTable).toHaveBeenCalledWith(codeEditor, { columns: 4, rows: 3 }))
        expect(codeEditor.focus).toHaveBeenCalled()
    })

    it('inserts nothing when the dialog is cancelled', async () => {
        vi.mocked(insertMarkdownTable).mockClear()
        const askTableSize = vi.fn(async () => null)
        const { run } = setUp(askTableSize)

        run('edit.table.insert')

        await waitFor(() => expect(askTableSize).toHaveBeenCalled())
        expect(insertMarkdownTable).not.toHaveBeenCalled()
    })

    it('does not ask for a size where no table can go, such as a code block', () => {
        vi.mocked(canInsertMarkdownTable).mockReturnValueOnce(false)
        const askTableSize = vi.fn(async () => null)
        const { run } = setUp(askTableSize)

        run('edit.table.insert')

        expect(askTableSize).not.toHaveBeenCalled()
    })

    it('runs the row, column and alignment commands on the table at the caret', () => {
        const { codeEditor, run } = setUp(async () => null, true)

        run('edit.table.move-row-down')
        run('edit.table.format')

        expect(vi.mocked(editMarkdownTable).mock.calls).toEqual([
            [codeEditor, 'move-row-down'],
            [codeEditor, 'format'],
        ])
    })
})
