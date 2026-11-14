'use client'

import { useMemo } from 'react'
import type { editor } from 'monaco-editor'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { runEditorAction, runInEditor } from '@/lib/monaco/editor-actions'
import { formatMarkdown, type MarkdownFormat } from '@/lib/monaco/markdown-editing'
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
    const formatCommands = FORMAT_COMMANDS.map(
        (spec): AppCommand => ({
            id: spec.id,
            label: spec.label,
            keywords: spec.keywords,
            keybind: spec.keybind,
            disabled: formatReason !== null,
            disabledReason: formatReason ?? undefined,
            run: () => ctx.runFormat(spec.format),
        })
    )
    return [...editorCommands, ...formatCommands]
}

export type EditorCommandsState = {
    /** The editor pane is showing. */
    shown: boolean
    readOnly: boolean
    /** The file is Markdown. */
    markdown: boolean
}

/**
 * Registers the editor's commands, acting on `codeEditor`: null while no file is open. Call from
 * the editor panel, which knows whether its editor is shown, whether the file can be edited and
 * whether it is Markdown.
 */
export function useEditorCommands(codeEditor: editor.ICodeEditor | null, { shown, readOnly, markdown }: EditorCommandsState): void {
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
            }),
        [codeEditor, shown, readOnly, markdown]
    )
    useRegisterCommands(commands)
}
