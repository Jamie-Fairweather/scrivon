import { describe, expect, it, vi } from 'vitest'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { bindMarkdownListEnter, formatMarkdown } from '@/lib/monaco/markdown-editing'

type Position = { lineNumber: number; column: number }
type Range = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** A text buffer with Monaco's line and column numbers (both from 1). */
class FakeModel {
    constructor(public text: string) {}
    private lines() {
        return this.text.split('\n')
    }
    getLineContent(lineNumber: number) {
        return this.lines()[lineNumber - 1] ?? ''
    }
    getValue() {
        return this.text
    }
    getOffsetAt({ lineNumber, column }: Position) {
        return this.lines()
            .slice(0, lineNumber - 1)
            .reduce((sum, line) => sum + line.length + 1, column - 1)
    }
    getPositionAt(offset: number): Position {
        const before = this.text.slice(0, offset).split('\n')
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
    trigger(_source: string, handlerId: string, payload: { text: string }) {
        if (handlerId === 'type') this.typed.push(payload.text)
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

    it('binds Enter only while typing in the text of an editable file, with no suggestion list open', () => {
        const { command } = bound('', at(1, 1))
        expect(command.keybinding).toBe(3)
        expect(command.context).toBe('editorTextFocus && !editorReadonly && !suggestWidgetVisible')
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
