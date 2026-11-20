'use client'

import { useMemo } from 'react'
import type { editor } from 'monaco-editor'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import type { StarterGalleryRequest } from '@/components/studio/dialogs/diagram-starters-provider'
import { insertDiagramStarter, starterInsertProblem, type StarterFileKind } from '@/lib/monaco/diagram-starter-insert'
import { runEditorAction, runInEditor } from '@/lib/monaco/editor-actions'
import { notifyInfo } from '@/lib/notify'
import type { TableAction, TableSize } from '@/lib/markdown/markdown-table'
import { canInsertMarkdownTable, editMarkdownTable, formatMarkdown, insertMarkdownTable, type MarkdownFormat } from '@/lib/monaco/markdown-editing'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import type { KeybindActionId, KeybindChord } from '@/lib/settings/types'

export type EditorCommandsContext = {
    /** 'none' when no file is open, 'hidden' while the editor pane is hidden. */
    editor: 'none' | 'hidden' | 'ready'
    readOnly: boolean
    /** The file is Markdown, so the Bold, Italic, Inline Code and Link helpers work. */
    markdown: boolean
    isMac: boolean
    /** Runs one of Monaco's own actions in the editor. */
    runAction: (monacoActionId: string) => void
    /** Runs one of the Markdown helpers in the editor. */
    runFormat: (format: MarkdownFormat) => void
    /** The caret is in a table, so the table commands work. It can be a moment old: each command looks again when it runs. */
    inTable: boolean
    /** Runs one of the table commands on the table at the caret. */
    runTable: (action: TableAction) => void
    /** Asks for the size of a new table and inserts it at the caret. */
    insertTable: () => void
    /** Opens the Diagram Starters window, to insert a starter at the caret or start a new file from one. */
    openStarters: () => void
}

type EditorCommandSpec = {
    /** Starts with 'edit.', so it can't clash with another feature's command. */
    id: string
    label: string
    keywords: string
    /** Monaco's id for the action. */
    action: string
    /** Monaco's keys, on Windows and Linux, then on a Mac. */
    keys: [KeybindChord, KeybindChord]
    /** Changes the text, so it can't run in a read-only file. */
    edits?: boolean
}

const ctrl = (key: string, extra: Omit<KeybindChord, 'key'> = {}): KeybindChord => ({ key, ctrl: true, ...extra })
const cmd = (key: string, extra: Omit<KeybindChord, 'key'> = {}): KeybindChord => ({ key, meta: true, ...extra })

/** The Edit menu, in order. The keys are the editor's own, which app shortcuts may not take (lib/settings/conflicts.ts). */
const EDITOR_COMMANDS: EditorCommandSpec[] = [
    { id: 'edit.undo', label: 'Undo', keywords: 'undo edit', action: 'undo', keys: [ctrl('z'), cmd('z')], edits: true },
    { id: 'edit.redo', label: 'Redo', keywords: 'redo edit', action: 'redo', keys: [ctrl('y'), cmd('z', { shift: true })], edits: true },
    { id: 'edit.cut', label: 'Cut', keywords: 'cut clipboard', action: 'editor.action.clipboardCutAction', keys: [ctrl('x'), cmd('x')], edits: true },
    { id: 'edit.copy', label: 'Copy', keywords: 'copy clipboard', action: 'editor.action.clipboardCopyAction', keys: [ctrl('c'), cmd('c')] },
    {
        id: 'edit.paste',
        label: 'Paste',
        keywords: 'paste clipboard',
        action: 'editor.action.clipboardPasteAction',
        keys: [ctrl('v'), cmd('v')],
        edits: true,
    },
    { id: 'edit.select-all', label: 'Select All', keywords: 'select all text', action: 'editor.action.selectAll', keys: [ctrl('a'), cmd('a')] },
    { id: 'edit.find', label: 'Find', keywords: 'find search in file', action: 'actions.find', keys: [ctrl('f'), cmd('f')] },
    {
        id: 'edit.replace',
        label: 'Replace',
        keywords: 'replace find search in file',
        action: 'editor.action.startFindReplaceAction',
        keys: [ctrl('h'), cmd('f', { alt: true })],
        edits: true,
    },
    {
        id: 'edit.go-to-line',
        label: 'Go to Line…',
        keywords: 'go to line number jump',
        action: 'editor.action.gotoLine',
        keys: [ctrl('g'), ctrl('g')],
    },
]

/** The Markdown helpers, after the editor's own commands in the Edit menu. Each toggles. */
const FORMAT_COMMANDS: { id: string; label: string; keywords: string; format: MarkdownFormat; keybind: KeybindActionId }[] = [
    { id: 'edit.bold', label: 'Bold', keywords: 'bold strong markdown format', format: 'bold', keybind: 'format.bold' },
    { id: 'edit.italic', label: 'Italic', keywords: 'italic emphasis markdown format', format: 'italic', keybind: 'format.italic' },
    {
        id: 'edit.inline-code',
        label: 'Inline Code',
        keywords: 'inline code backtick monospace markdown format',
        format: 'code',
        keybind: 'format.code',
    },
    { id: 'edit.link', label: 'Link', keywords: 'link hyperlink url address markdown format', format: 'link', keybind: 'format.link' },
]

/** The id of Insert Table…, which the Edit menu's Table submenu starts with. */
export const INSERT_TABLE_ID = 'edit.table.insert'
/** The id of Format Table, which the Table submenu ends with. */
export const FORMAT_TABLE_ID = 'edit.table.format'

type TableCommandSpec = {
    id: string
    /** The palette's label. */
    label: string
    /** The label in the Edit menu's Table submenu, which already says it's about a table. */
    menuLabel: string
    keywords: string
    action: TableAction
}

const tableCommand = (action: TableAction, menuLabel: string, keywords: string): TableCommandSpec => ({
    id: `edit.table.${action}`,
    label: `Table: ${menuLabel}`,
    menuLabel,
    keywords,
    action,
})

/** The row, column and alignment commands, in the Table submenu's order, in groups between separators. */
export const TABLE_COMMAND_GROUPS: TableCommandSpec[][] = [
    [
        tableCommand('insert-row-above', 'Insert Row Above', 'add new'),
        tableCommand('insert-row-below', 'Insert Row Below', 'add new'),
        tableCommand('delete-row', 'Delete Row', 'remove'),
        tableCommand('move-row-up', 'Move Row Up', 'reorder'),
        tableCommand('move-row-down', 'Move Row Down', 'reorder'),
    ],
    [
        tableCommand('insert-column-left', 'Insert Column Left', 'add new'),
        tableCommand('insert-column-right', 'Insert Column Right', 'add new'),
        tableCommand('delete-column', 'Delete Column', 'remove'),
        tableCommand('move-column-left', 'Move Column Left', 'reorder'),
        tableCommand('move-column-right', 'Move Column Right', 'reorder'),
    ],
    [
        tableCommand('align-left', 'Align Column Left', 'alignment'),
        tableCommand('align-center', 'Align Column Centre', 'alignment center middle'),
        tableCommand('align-right', 'Align Column Right', 'alignment'),
        tableCommand('align-none', 'Align Column None', 'alignment clear remove default'),
    ],
]

/** Insert Table…, the row, column and alignment commands, and Format Table. */
function buildTableCommands(ctx: EditorCommandsContext, unavailable: string | null): AppCommand[] {
    const fileReason = unavailable ?? (!ctx.markdown ? 'Only in Markdown files' : ctx.readOnly ? 'This file is read-only' : null)
    const insertReason = fileReason ?? (ctx.inTable ? 'The caret is already in a table' : null)
    const tableReason = fileReason ?? (!ctx.inTable ? 'Put the caret in a table' : null)
    const keywords = (more: string) => `table markdown gfm ${more}`
    const insert: AppCommand = {
        id: INSERT_TABLE_ID,
        label: 'Insert Table…',
        keywords: keywords('add new grid'),
        keybind: 'format.insertTable',
        disabled: insertReason !== null,
        disabledReason: insertReason ?? undefined,
        keepsKeysWhenOff: ctx.markdown,
        run: () => ctx.insertTable(),
    }
    const changes = TABLE_COMMAND_GROUPS.flat().map((spec): AppCommand => ({
        id: spec.id,
        label: spec.label,
        keywords: keywords(spec.keywords),
        disabled: tableReason !== null,
        disabledReason: tableReason ?? undefined,
        run: () => ctx.runTable(spec.action),
    }))
    const format: AppCommand = {
        id: FORMAT_TABLE_ID,
        label: 'Format Table',
        keywords: keywords('tidy align pipes columns prettify'),
        keybind: 'format.table',
        disabled: tableReason !== null,
        disabledReason: tableReason ?? undefined,
        // In a Markdown file Shift+Alt+F is Format Table's, even outside a table. In other files it goes on to the editor.
        keepsKeysWhenOff: ctx.markdown,
        run: () => ctx.runTable('format'),
    }
    return [insert, ...changes, format]
}

/** Undo, the clipboard, Find, the rest of the editor's own actions and the Markdown helpers, for the Edit menu and the palette. */
export function buildEditorCommands(ctx: EditorCommandsContext): AppCommand[] {
    const unavailable = ctx.editor === 'none' ? 'No file open' : ctx.editor === 'hidden' ? 'The editor is hidden' : null
    const editorCommands = EDITOR_COMMANDS.map((spec): AppCommand => {
        const reason = unavailable ?? (spec.edits && ctx.readOnly ? 'This file is read-only' : null)
        return {
            id: spec.id,
            label: spec.label,
            keywords: spec.keywords,
            keys: spec.keys[ctx.isMac ? 1 : 0],
            disabled: reason !== null,
            disabledReason: reason ?? undefined,
            run: () => ctx.runAction(spec.action),
        }
    })
    const formatReason = unavailable ?? (!ctx.markdown ? 'Only in Markdown files' : ctx.readOnly ? 'This file is read-only' : null)
    const formatCommands = FORMAT_COMMANDS.map((spec): AppCommand => ({
        id: spec.id,
        label: spec.label,
        keywords: spec.keywords,
        keybind: spec.keybind,
        disabled: formatReason !== null,
        disabledReason: formatReason ?? undefined,
        // In a Markdown file the keys are the helper's, even when it's read-only (Ctrl+E mustn't hide the editor).
        keepsKeysWhenOff: ctx.markdown,
        run: () => ctx.runFormat(spec.format),
    }))
    // On in any file that can be edited: the window says when Insert can't go in this file, and New File still works.
    const starterReason = unavailable ?? (ctx.readOnly ? 'This file is read-only' : null)
    const insertStarter: AppCommand = {
        id: INSERT_DIAGRAM_STARTER_ID,
        label: 'Insert Diagram Starter…',
        keywords: 'insert diagram starter gallery mermaid snippet flowchart sequence class state entity relationship er xy chart',
        disabled: starterReason !== null,
        disabledReason: starterReason ?? undefined,
        run: () => ctx.openStarters(),
    }
    return [...editorCommands, ...formatCommands, ...buildTableCommands(ctx, unavailable), insertStarter]
}

/** The id of Insert Diagram Starter…, which the Edit menu shows after the Markdown helpers. */
export const INSERT_DIAGRAM_STARTER_ID = 'edit.insert-diagram-starter'

export type EditorCommandsState = {
    /**
     * False for the editor of a group without the keyboard, while the editor is split: the focused group's editor
     * registers the commands, so the Edit menu and the palette act on it. True when left out.
     */
    register?: boolean
    /** The editor pane is showing. */
    shown: boolean
    readOnly: boolean
    /** The file is Markdown. */
    markdown: boolean
    /** The caret is in a table (see isLineInTable). */
    inTable: boolean
    /** Asks for the size of a new table: null when the user cancels. */
    askTableSize: () => Promise<TableSize | null>
    /** What kind of file is open, which says where a diagram starter goes in it. */
    fileKind: StarterFileKind
    /** Opens the Diagram Starters window (useDiagramStarters). */
    openStarterGallery: (request: StarterGalleryRequest) => void
}

/**
 * Registers the editor's commands, acting on `codeEditor`: null while no file is open. Call from
 * the editor panel, which knows whether its editor is shown, whether the file can be edited and
 * whether it is Markdown.
 */
export function useEditorCommands(
    codeEditor: editor.ICodeEditor | null,
    { register = true, shown, readOnly, markdown, inTable, askTableSize, fileKind, openStarterGallery }: EditorCommandsState
): void {
    const commands = useMemo(
        () =>
            buildEditorCommands({
                editor: !codeEditor ? 'none' : shown ? 'ready' : 'hidden',
                readOnly,
                markdown,
                isMac: isMacPlatform(),
                runAction: (action) => {
                    if (codeEditor) runEditorAction(codeEditor, action)
                },
                runFormat: (format) => {
                    if (codeEditor) runInEditor(codeEditor, () => formatMarkdown(codeEditor, format))
                },
                inTable,
                runTable: (action) => {
                    if (codeEditor) runInEditor(codeEditor, () => editMarkdownTable(codeEditor, action))
                },
                insertTable: () => {
                    if (!codeEditor) return
                    // The editor has focus as the dialog opens, so the dialog gives it back when it closes.
                    runInEditor(codeEditor, () => {
                        if (!canInsertMarkdownTable(codeEditor)) return
                        const model = codeEditor.getModel()
                        void askTableSize().then((size) => {
                            // The tab may have closed or changed meanwhile.
                            if (!size || !model || codeEditor.getModel() !== model) return
                            codeEditor.focus()
                            insertMarkdownTable(codeEditor, size)
                        })
                    })
                },
                openStarters: () => {
                    if (!codeEditor) return
                    // The starter goes in the file open now; if the tab changes or closes meanwhile, it isn't put in another.
                    const model = codeEditor.getModel()
                    const sameFile = () => model !== null && codeEditor.getModel() === model
                    openStarterGallery({
                        primary: 'insert',
                        insert: {
                            problem: () => (sameFile() ? starterInsertProblem(codeEditor, fileKind) : 'No file open'),
                            watch: (onChange) => {
                                const subscriptions = [
                                    codeEditor.onDidChangeModelContent(onChange),
                                    codeEditor.onDidChangeCursorSelection(onChange),
                                    codeEditor.onDidChangeModel(onChange),
                                    // Read-only comes and goes as an option.
                                    codeEditor.onDidChangeConfiguration(onChange),
                                ]
                                return () => subscriptions.forEach((subscription) => subscription.dispose())
                            },
                            // Snippets go in at the focused editor's caret, so it takes focus first.
                            run: (snippet) =>
                                runInEditor(codeEditor, () => {
                                    if (!sameFile()) return
                                    const problem = insertDiagramStarter(codeEditor, fileKind, snippet)
                                    if (problem) notifyInfo(problem, { id: 'diagram-starter' })
                                }),
                        },
                    })
                },
            }),
        [codeEditor, shown, readOnly, markdown, inTable, askTableSize, fileKind, openStarterGallery]
    )
    useRegisterCommands(register ? commands : NO_COMMANDS)
}

const NO_COMMANDS: AppCommand[] = []
