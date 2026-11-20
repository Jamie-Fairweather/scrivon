// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import type { editor } from 'monaco-editor'
import { describe, expect, it, vi } from 'vitest'
import { commandShortcut, type AppCommand } from '@/components/studio/commands/app-command'
import { buildEditorCommands, useEditorCommands, type EditorCommandsContext } from '@/components/studio/editor/editor-commands'
import type { StarterGalleryRequest } from '@/components/studio/dialogs/diagram-starters-provider'
import type { TableSize } from '@/lib/markdown/markdown-table'
import { insertDiagramStarter, starterInsertProblem } from '@/lib/monaco/diagram-starter-insert'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { notifyInfo } from '@/lib/notify'
import { canInsertMarkdownTable, editMarkdownTable, insertMarkdownTable } from '@/lib/monaco/markdown-editing'
import { describeEditorChordClash, findKeybindConflicts, wouldChordConflict } from '@/lib/settings/conflicts'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

vi.mock('@/lib/monaco/diagram-starter-insert', () => ({
    starterInsertProblem: vi.fn(() => null),
    insertDiagramStarter: vi.fn(() => null),
}))
vi.mock('@/lib/notify', () => ({ notifyInfo: vi.fn() }))
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
        openStarters: vi.fn(),
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
            ['Insert Diagram Starter…', undefined],
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
            'edit.insert-diagram-starter',
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

describe('buildEditorCommands Insert Diagram Starter', () => {
    it('opens the Diagram Starters window, in Markdown and diagram files alike', () => {
        for (const markdown of [true, false]) {
            const ctx = context({ markdown })
            const command = find(ctx, 'edit.insert-diagram-starter')!
            expect(command).toMatchObject({ label: 'Insert Diagram Starter…', disabled: false })
            expect(command.keybind).toBeUndefined()
            void command.run()
            expect(ctx.openStarters).toHaveBeenCalledTimes(1)
        }
    })

    it.each([
        [{ editor: 'none' } as const, 'No file open'],
        [{ editor: 'hidden' } as const, 'The editor is hidden'],
        [{ readOnly: true }, 'This file is read-only'],
    ])('is off with %o, saying why as the other Edit commands do', (overrides, reason) => {
        expect(find(context(overrides), 'edit.insert-diagram-starter')).toMatchObject({ disabled: true, disabledReason: reason })
        expect(find(context(overrides), 'edit.cut')).toMatchObject({ disabledReason: reason })
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
        const shiftAltF = { key: 'f', shift: true, alt: true }
        expect(describeEditorChordClash(shiftAltF, false, 'format.table')).toBeNull()
        expect(wouldChordConflict(createDefaultKeybinds(false), 'format.table', shiftAltF)).toBeNull()
    })
})

describe('useEditorCommands table helpers', () => {
    /** The editor's commands for a Markdown file, run from a shortcut typed in the editor (so at once). */
    function setUp(askTableSize: () => Promise<TableSize | null>, inTable = false) {
        const model = {}
        const codeEditor = { getModel: vi.fn(() => model), focus: vi.fn(), hasTextFocus: () => true }
        renderHook(() =>
            useEditorCommands(codeEditor as unknown as editor.ICodeEditor, {
                shown: true,
                readOnly: false,
                markdown: true,
                inTable,
                askTableSize,
                fileKind: 'markdown',
                openStarterGallery: vi.fn(),
            })
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

describe('useEditorCommands Insert Diagram Starter', () => {
    function setUp(fileKind: 'markdown' | 'mermaid' = 'mermaid', { textFocus = true } = {}) {
        let model: object | null = {}
        // One entry per subscription, gone once it is disposed.
        const listeners = new Set<object>()
        const listen = () => {
            const subscription = {}
            listeners.add(subscription)
            return { dispose: () => listeners.delete(subscription) }
        }
        const codeEditor = {
            getModel: vi.fn(() => model),
            focus: vi.fn(),
            hasTextFocus: () => textFocus,
            onDidChangeModelContent: vi.fn(listen),
            onDidChangeCursorSelection: vi.fn(listen),
            onDidChangeModel: vi.fn(listen),
            onDidChangeConfiguration: vi.fn(listen),
        }
        const openStarterGallery = vi.fn<(request: StarterGalleryRequest) => void>()
        renderHook(() =>
            useEditorCommands(codeEditor as unknown as editor.ICodeEditor, {
                shown: true,
                readOnly: false,
                markdown: fileKind === 'markdown',
                inTable: false,
                askTableSize: async () => null,
                fileKind,
                openStarterGallery,
            })
        )
        act(() => void registered.current.find((command) => command.id === 'edit.insert-diagram-starter')!.run())
        const request = openStarterGallery.mock.calls[0]![0]
        return { codeEditor, request, listeners, changeFile: () => (model = {}) }
    }

    it("tells the window when the file's text, the caret, the file shown or read-only changes, until it stops", () => {
        const { codeEditor, request, listeners } = setUp('mermaid')
        const onChange = vi.fn()

        const stop = request.insert!.watch!(onChange)

        for (const event of ['onDidChangeModelContent', 'onDidChangeCursorSelection', 'onDidChangeModel', 'onDidChangeConfiguration'] as const) {
            expect(codeEditor[event]).toHaveBeenCalledWith(onChange)
        }
        expect(listeners.size).toBe(4)
        stop()
        expect(listeners.size).toBe(0)
    })

    it('gives the editor focus before inserting, once the window has handed it back', () => {
        vi.mocked(insertDiagramStarter).mockClear()
        const frames: FrameRequestCallback[] = []
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback)
            return frames.length
        })
        const { codeEditor, request } = setUp('markdown', { textFocus: false })
        let focusedFirst = false
        vi.mocked(insertDiagramStarter).mockImplementationOnce(() => {
            focusedFirst = codeEditor.focus.mock.calls.length > 0
            return null
        })

        request.insert!.run(MERMAID_SNIPPETS[0])
        expect(insertDiagramStarter).not.toHaveBeenCalled()
        for (const frame of frames.splice(0)) frame(0)

        expect(codeEditor.focus).toHaveBeenCalledTimes(1)
        expect(insertDiagramStarter).toHaveBeenCalledExactlyOnceWith(codeEditor, 'markdown', MERMAID_SNIPPETS[0])
        expect(focusedFirst).toBe(true)
        raf.mockRestore()
    })

    it('opens the window with Insert as its main button, checking and inserting in this editor', () => {
        vi.mocked(starterInsertProblem).mockReturnValueOnce('This diagram file already has text')
        const { codeEditor, request } = setUp('mermaid')

        expect(request.primary).toBe('insert')
        expect(request.insert!.problem()).toBe('This diagram file already has text')
        expect(starterInsertProblem).toHaveBeenLastCalledWith(codeEditor, 'mermaid')

        request.insert!.run(MERMAID_SNIPPETS[2])
        expect(insertDiagramStarter).toHaveBeenCalledExactlyOnceWith(codeEditor, 'mermaid', MERMAID_SNIPPETS[2])
    })

    it('says why when the insert fails on its final check', () => {
        vi.mocked(insertDiagramStarter).mockReturnValueOnce('The cursor is inside a code block')
        const { request } = setUp('markdown')

        request.insert!.run(MERMAID_SNIPPETS[0])

        expect(notifyInfo).toHaveBeenCalledWith('The cursor is inside a code block', expect.anything())
    })

    it('puts nothing in another file when the tab changed while the window was open', () => {
        vi.mocked(insertDiagramStarter).mockClear()
        const { request, changeFile } = setUp()

        changeFile()

        expect(request.insert!.problem()).toBe('No file open')
        request.insert!.run(MERMAID_SNIPPETS[0])
        expect(insertDiagramStarter).not.toHaveBeenCalled()
    })
})
