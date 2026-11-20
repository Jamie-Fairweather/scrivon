import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { ContextKeyExpr } from 'monaco-editor/platform/contextkey/common/contextkey.js'
import { bindMarkdownListEnter, canInsertMarkdownTable, editMarkdownTable, formatMarkdown, insertMarkdownTable } from '@/lib/monaco/markdown-editing'
import { notifyInfo } from '@/lib/notify'

vi.mock('@/lib/notify', () => ({ notifyInfo: vi.fn() }))

type Position = { lineNumber: number; column: number }
type Range = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** A text buffer with Monaco's line and column numbers (both from 1), and one line ending for the whole buffer. */
class FakeModel {
    constructor(
        public text: string,
        readonly eol: '\n' | '\r\n' = '\n'
    ) {}
    private lines() {
        return this.text.split(this.eol)
    }
    getLineContent(lineNumber: number) {
        return this.lines()[lineNumber - 1] ?? ''
    }
    getLineCount() {
        return this.lines().length
    }
    getLineMaxColumn(lineNumber: number) {
        return this.getLineContent(lineNumber).length + 1
    }
    getEOL() {
        return this.eol
    }
    getValue() {
        return this.text
    }
    getOffsetAt({ lineNumber, column }: Position) {
        return this.lines()
            .slice(0, lineNumber - 1)
            .reduce((sum, line) => sum + line.length + this.eol.length, column - 1)
    }
    getPositionAt(offset: number): Position {
        const before = this.text.slice(0, offset).split(this.eol)
        return { lineNumber: before.length, column: before.at(-1)!.length + 1 }
    }
}

/** An editor with the parts these helpers use. Selections are written as `{ from, to }` positions. */
class FakeEditor {
    readonly undoStops: number[] = []
    readonly typed: string[] = []
    readonly commands: { keybinding: number; handler: () => void; context?: string }[] = []
    selections: Range[]
    constructor(
        public model: FakeModel,
        selections: [Position, Position][]
    ) {
        this.selections = selections.map(([from, to]) => ({
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
        }))
    }
    getModel() {
        return this.model
    }
    getSelections() {
        return this.selections
    }
    /** Like Monaco: where the primary (first) selection ends. */
    getPosition(): Position | null {
        const [primary] = this.selections
        return primary ? { lineNumber: primary.endLineNumber, column: primary.endColumn } : null
    }
    readOnly = false
    getRawOptions() {
        return { readOnly: this.readOnly }
    }
    pushUndoStop() {
        this.undoStops.push(this.model.text.length)
        return true
    }
    executeEdits(_source: string, edits: { range: Range; text: string }[]) {
        const offsets = edits.map((edit) => ({
            start: this.model.getOffsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn }),
            end: this.model.getOffsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn }),
            text: edit.text,
        }))
        for (const edit of offsets.sort((a, b) => b.start - a.start)) {
            this.model.text = this.model.text.slice(0, edit.start) + edit.text + this.model.text.slice(edit.end)
        }
        return true
    }
    setSelections(
        selections: { selectionStartLineNumber: number; selectionStartColumn: number; positionLineNumber: number; positionColumn: number }[]
    ) {
        this.selections = selections.map((s) => ({
            startLineNumber: s.selectionStartLineNumber,
            startColumn: s.selectionStartColumn,
            endLineNumber: s.positionLineNumber,
            endColumn: s.positionColumn,
        }))
    }
    addCommand(keybinding: number, handler: () => void, context?: string) {
        this.commands.push({ keybinding, handler, context })
        return 'command'
    }
    /** Whether a suggestion list is open, and the commands run on the editor, in order. */
    suggestOpen = false
    readonly triggered: string[] = []
    trigger(_source: string, handlerId: string, payload: { text: string }) {
        this.triggered.push(handlerId)
        if (handlerId === 'type') this.typed.push(payload.text)
        if (handlerId === 'hideSuggestWidget') this.suggestOpen = false
    }
    readonly contextKeys = new Map<string, unknown>()
    createContextKey(key: string, value: unknown) {
        this.contextKeys.set(key, value)
        return { set: (next: unknown) => this.contextKeys.set(key, next) }
    }
    private readonly listeners: (() => void)[] = []
    private listen = (listener: () => void) => {
        this.listeners.push(listener)
        return { dispose: () => {} }
    }
    onDidChangeModel = this.listen
    onDidChangeCursorPosition = this.listen
    onDidFocusEditorText = this.listen
    /** As Monaco does when the caret moves or another file is shown. */
    changed() {
        for (const listener of this.listeners) listener()
    }
    /** The text with each selection shown as «…» and each caret as |. */
    shown() {
        let text = this.model.text
        const ranges = this.selections.map((s) => ({
            start: this.model.getOffsetAt({ lineNumber: s.startLineNumber, column: s.startColumn }),
            end: this.model.getOffsetAt({ lineNumber: s.endLineNumber, column: s.endColumn }),
        }))
        for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) {
            text =
                start === end
                    ? `${text.slice(0, start)}|${text.slice(start)}`
                    : `${text.slice(0, start)}«${text.slice(start, end)}»${text.slice(end)}`
        }
        return text
    }
}

const at = (lineNumber: number, column: number): Position => ({ lineNumber, column })
const asEditor = (fake: FakeEditor) => fake as unknown as editor.ICodeEditor

describe('formatMarkdown', () => {
    it('formats every selection as one undo step and selects the text again', () => {
        const fake = new FakeEditor(new FakeModel('one\ntwo three'), [
            [at(1, 1), at(1, 4)],
            [at(2, 5), at(2, 10)],
        ])

        formatMarkdown(asEditor(fake), 'bold')

        expect(fake.shown()).toBe('**«one»**\ntwo **«three»**')
        expect(fake.undoStops).toHaveLength(2)
    })

    it('takes formatting off, and makes links', () => {
        const fake = new FakeEditor(new FakeModel('an *idea*'), [[at(1, 6), at(1, 6)]])
        formatMarkdown(asEditor(fake), 'italic')
        expect(fake.shown()).toBe('an i|dea')

        formatMarkdown(asEditor(fake), 'link')
        expect(fake.shown()).toBe('an [idea](|)')

        formatMarkdown(asEditor(fake), 'code')
        expect(fake.shown()).toBe('an [idea](`|`)')
    })

    it('does nothing without a file', () => {
        const fake = new FakeEditor(new FakeModel(''), [])
        fake.getModel = () => null as unknown as FakeModel

        formatMarkdown(asEditor(fake), 'bold')

        expect(fake.undoStops).toHaveLength(0)
    })
})

describe('bindMarkdownListEnter', () => {
    const monaco = { KeyCode: { Enter: 3 } } as unknown as Monaco

    function bound(text: string, caret: Position, isMarkdown = true) {
        const fake = new FakeEditor(new FakeModel(text), [[caret, caret]])
        bindMarkdownListEnter(fake as unknown as editor.IStandaloneCodeEditor, monaco, () => isMarkdown)
        const [command] = fake.commands
        return { fake, command: command!, enter: () => command!.handler() }
    }

    it('binds Enter only while typing in the text of an editable file, and with a suggestion list open only in Markdown', () => {
        const { command } = bound('', at(1, 1))
        expect(command.keybinding).toBe(3)
        expect(command.context).toBe(
            'editorTextFocus && !editorReadonly && !suggestWidgetVisible || editorTextFocus && !editorReadonly && scrivonMarkdownTab'
        )
        // As Monaco reads it.
        const when = ContextKeyExpr.deserialize(command.context!)!
        const holds = (keys: Record<string, boolean>) => when.evaluate({ getValue: (key: string) => keys[key] } as never)
        expect(holds({ editorTextFocus: true })).toBe(true)
        expect(holds({ editorTextFocus: true, suggestWidgetVisible: true })).toBe(false)
        expect(holds({ editorTextFocus: true, suggestWidgetVisible: true, scrivonMarkdownTab: true })).toBe(true)
        expect(holds({ editorTextFocus: true, editorReadonly: true, scrivonMarkdownTab: true })).toBe(false)
    })

    it('keeps the Markdown key in step with the file showing', () => {
        let markdown = true
        const fake = new FakeEditor(new FakeModel(''), [[at(1, 1), at(1, 1)]])
        bindMarkdownListEnter(fake as unknown as editor.IStandaloneCodeEditor, monaco, () => markdown)
        expect(fake.contextKeys.get('scrivonMarkdownTab')).toBe(true)
        markdown = false
        fake.changed()
        expect(fake.contextKeys.get('scrivonMarkdownTab')).toBe(false)
    })

    it('closes an open suggestion list in a Markdown list item, then continues the list as Enter does without it', () => {
        const { fake, enter } = bound('- see [[Pla', at(1, 12))
        fake.suggestOpen = true
        enter()
        expect(fake.suggestOpen).toBe(false)
        expect(fake.triggered[0]).toBe('hideSuggestWidget')
        expect(fake.shown()).toBe('- see [[Pla\n- |')
        expect(fake.typed).toEqual([])

        const plain = bound('text [[Pla', at(1, 11))
        plain.fake.suggestOpen = true
        plain.enter()
        expect(plain.fake.suggestOpen).toBe(false)
        expect(plain.fake.typed).toEqual(['\n'])
    })

    it('continues a list as one undo step, and ends it on an empty item', () => {
        const { fake, enter } = bound('- one', at(1, 6))

        enter()
        expect(fake.shown()).toBe('- one\n- |')
        expect(fake.undoStops).toHaveLength(2)

        enter()
        expect(fake.shown()).toBe('- one\n|')
        expect(fake.typed).toEqual([])
    })

    it('types a plain new line away from a list, outside Markdown files, and with more than one caret', () => {
        const plain = bound('text', at(1, 5))
        plain.enter()
        expect(plain.fake.typed).toEqual(['\n'])

        const mermaid = bound('- one', at(1, 6), false)
        mermaid.enter()
        expect(mermaid.fake.typed).toEqual(['\n'])
        expect(mermaid.fake.model.text).toBe('- one')

        const twoCarets = bound('- one', at(1, 6))
        twoCarets.fake.selections.push({ ...twoCarets.fake.selections[0]! })
        twoCarets.enter()
        expect(twoCarets.fake.typed).toEqual(['\n'])
    })

    it('types a plain new line over a selection', () => {
        const { fake, enter } = bound('- one', at(1, 3))
        fake.selections = [{ startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 }]

        enter()

        expect(fake.typed).toEqual(['\n'])
    })
})

describe('formatMarkdown with a spy editor', () => {
    it('leaves the editor alone when there is nothing to change', () => {
        const fake = new FakeEditor(new FakeModel('x'), [])
        const executeEdits = vi.spyOn(fake, 'executeEdits')

        formatMarkdown(asEditor(fake), 'bold')

        expect(executeEdits).not.toHaveBeenCalled()
    })
})

describe('editMarkdownTable', () => {
    const caretAt = (lineNumber: number, column: number): [Position, Position] => [at(lineNumber, column), at(lineNumber, column)]

    beforeEach(() => {
        vi.mocked(notifyInfo).mockClear()
    })

    it('formats the table at the caret as one undo step, keeping the caret in its cell', () => {
        const fake = new FakeEditor(new FakeModel('Intro\n\n|a|bb|\n|:-:|-:|\n|中文|x|\n'), [caretAt(5, 5)])

        editMarkdownTable(asEditor(fake), 'format')

        expect(fake.model.text).toBe('Intro\n\n|  a   |  bb |\n| :--: | --: |\n| 中文 |   x |\n')
        expect(fake.undoStops).toHaveLength(2)
        // Before the x, which moved right.
        expect(fake.getPosition()).toEqual(at(5, 10))
    })

    it('keeps \\r\\n line endings', () => {
        const fake = new FakeEditor(new FakeModel('|a|b|\r\n|-|-|\r\n|1|2|\r\nafter', '\r\n'), [caretAt(3, 2)])

        editMarkdownTable(asEditor(fake), 'insert-row-below')

        expect(fake.model.text).toBe('| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |\r\n|     |     |\r\nafter')
    })

    it('deletes rows, the last line of the file too', () => {
        const middle = new FakeEditor(new FakeModel('| a   |\n| --- |\n| 1   |\n| 2   |'), [caretAt(3, 3)])
        editMarkdownTable(asEditor(middle), 'delete-row')
        expect(middle.model.text).toBe('| a   |\n| --- |\n| 2   |')
        expect(middle.getPosition()).toEqual(at(3, 3))

        const last = new FakeEditor(new FakeModel('| a   |\n| --- |\n| 1   |'), [caretAt(3, 3)])
        editMarkdownTable(asEditor(last), 'delete-row')
        expect(last.model.text).toBe('| a   |\n| --- |')
        expect(last.getPosition()).toEqual(at(1, 3))
    })

    it('acts on the primary caret only, and leaves one caret where the command puts it', () => {
        const text = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n| c   |\n| --- |'
        const fake = new FakeEditor(new FakeModel(text), [[at(3, 3), at(3, 9)], caretAt(5, 3)])

        editMarkdownTable(asEditor(fake), 'move-column-left')

        // The primary selection ended in the second cell, which moved left with the column; the other table is untouched.
        expect(fake.model.text).toBe('| b   | a   |\n| --- | --- |\n| 2   | 1   |\n\n| c   |\n| --- |')
        expect(fake.selections).toEqual([{ startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 3 }])
    })

    it('makes no edit and adds no undo stop just outside a table, and says why', () => {
        const fake = new FakeEditor(new FakeModel('text\n| a | b |\n|---|---|'), [caretAt(1, 2)])
        const executeEdits = vi.spyOn(fake, 'executeEdits')

        editMarkdownTable(asEditor(fake), 'delete-row')

        expect(executeEdits).not.toHaveBeenCalled()
        expect(fake.undoStops).toHaveLength(0)
        expect(notifyInfo).toHaveBeenCalledWith('Put the caret in a table', { id: 'markdown-table' })
    })

    it('leaves a table in a code block alone, and says why', () => {
        const fake = new FakeEditor(new FakeModel('```\n|a|b|\n|-|-|\n```'), [caretAt(2, 2)])

        editMarkdownTable(asEditor(fake), 'format')

        expect(fake.model.text).toBe('```\n|a|b|\n|-|-|\n```')
        expect(fake.undoStops).toHaveLength(0)
        expect(notifyInfo).toHaveBeenCalledWith('Tables in a code block are left as they are', { id: 'markdown-table' })
    })

    it('makes no edit in a read-only file', () => {
        const fake = new FakeEditor(new FakeModel('|a|b|\n|-|-|'), [caretAt(1, 2)])
        fake.readOnly = true

        editMarkdownTable(asEditor(fake), 'format')

        expect(fake.model.text).toBe('|a|b|\n|-|-|')
        expect(fake.undoStops).toHaveLength(0)
    })

    it('makes no edit and adds no undo stop when the command changes nothing', () => {
        const fake = new FakeEditor(new FakeModel('| a   |\n| --- |\n| 1   |'), [caretAt(1, 3)])

        editMarkdownTable(asEditor(fake), 'format')
        editMarkdownTable(asEditor(fake), 'delete-row')
        editMarkdownTable(asEditor(fake), 'move-row-up')

        expect(fake.undoStops).toHaveLength(0)
        expect(notifyInfo).not.toHaveBeenCalled()
    })
})

describe('insertMarkdownTable', () => {
    beforeEach(() => {
        vi.mocked(notifyInfo).mockClear()
    })

    it('inserts the table after the caret’s line as one undo step, with the caret in the first header cell', () => {
        const fake = new FakeEditor(new FakeModel('Some text\r\nMore', '\r\n'), [[at(1, 3), at(1, 6)]])

        insertMarkdownTable(asEditor(fake), { columns: 2, rows: 1 })

        expect(fake.model.text).toBe('Some text\r\n\r\n|     |     |\r\n| --- | --- |\r\n|     |     |\r\n\r\nMore')
        expect(fake.undoStops).toHaveLength(2)
        expect(fake.selections).toEqual([{ startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 3 }])
    })

    it('inserts at the end of the file', () => {
        const fake = new FakeEditor(new FakeModel('Last'), [caretAt(1, 5)])

        insertMarkdownTable(asEditor(fake), { columns: 1, rows: 1 })

        expect(fake.model.text).toBe('Last\n\n|     |\n| --- |\n|     |')
    })

    it('makes no edit in a code block or a table, and says why', () => {
        const code = new FakeEditor(new FakeModel('```\n\n```'), [caretAt(2, 1)])
        expect(canInsertMarkdownTable(asEditor(code))).toBe(false)
        insertMarkdownTable(asEditor(code), { columns: 1, rows: 1 })
        expect(code.model.text).toBe('```\n\n```')
        expect(code.undoStops).toHaveLength(0)
        expect(notifyInfo).toHaveBeenLastCalledWith("A table can't go inside a code block", { id: 'markdown-table' })

        const table = new FakeEditor(new FakeModel('|a|\n|-|'), [caretAt(1, 2)])
        expect(canInsertMarkdownTable(asEditor(table))).toBe(false)
        expect(notifyInfo).toHaveBeenLastCalledWith('The caret is already in a table', { id: 'markdown-table' })

        expect(canInsertMarkdownTable(asEditor(new FakeEditor(new FakeModel('text'), [caretAt(1, 1)])))).toBe(true)
    })

    function caretAt(lineNumber: number, column: number): [Position, Position] {
        return [at(lineNumber, column), at(lineNumber, column)]
    }
})
