import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { trackEditorCursor, useEditorCursor, type CursorSource } from './editor-cursor'

type Range = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** Just enough of a Monaco editor: a text, a caret and selections, and its change events. */
function fakeEditor(lines: string[]) {
    const listeners = { cursor: new Set<() => void>(), model: new Set<() => void>(), content: new Set<() => void>(), dispose: new Set<() => void>() }
    const on = (set: Set<() => void>) => (listener: () => void) => {
        set.add(listener)
        return { dispose: () => set.delete(listener) }
    }
    const fire = (set: Set<() => void>) => [...set].forEach((listener) => listener())
    let hasModel = true
    let selections: Range[] = [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }]
    const model = {
        getValueInRange: (r: Range) => {
            const text = lines.join('\n')
            const offset = (line: number, column: number) => lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1
            return text.slice(offset(r.startLineNumber, r.startColumn), offset(r.endLineNumber, r.endColumn))
        },
    }
    const isEmpty = (r: Range) => r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn
    const editor = {
        getModel: () => (hasModel ? model : null),
        getPosition: () => {
            const last = selections[selections.length - 1]
            return last ? { lineNumber: last.endLineNumber, column: last.endColumn } : null
        },
        getSelections: () => selections.map((r) => ({ ...r, isEmpty: () => isEmpty(r) })),
        onDidChangeCursorSelection: on(listeners.cursor),
        onDidChangeModel: on(listeners.model),
        onDidChangeModelContent: on(listeners.content),
        onDidDispose: on(listeners.dispose),
    } as unknown as CursorSource

    return {
        editor,
        select(...ranges: Range[]) {
            selections = ranges
            act(() => fire(listeners.cursor))
        },
        setText(next: string[]) {
            lines.splice(0, lines.length, ...next)
            act(() => fire(listeners.content))
        },
        detachModel() {
            hasModel = false
            act(() => fire(listeners.model))
        },
        dispose() {
            act(() => fire(listeners.dispose))
        },
        listenerCount: () => Object.values(listeners).reduce((n, set) => n + set.size, 0),
    }
}

const caret = (line: number, column: number): Range => ({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column })

let stop: (() => void) | undefined
afterEach(() => {
    act(() => stop?.())
    stop = undefined
})

describe('editor cursor', () => {
    it('is unknown until an editor reports it', () => {
        const { result } = renderHook(() => useEditorCursor())
        expect(result.current).toBeNull()
    })

    it("follows the editor's caret, with no selected text while nothing is selected", () => {
        const fake = fakeEditor(['hello world', 'second line'])
        const { result } = renderHook(() => useEditorCursor())
        act(() => {
            stop = trackEditorCursor(fake.editor)
        })
        expect(result.current).toEqual({ line: 1, column: 1, selectedText: '' })

        fake.select(caret(2, 4))
        expect(result.current).toEqual({ line: 2, column: 4, selectedText: '' })
    })

    it('gives the selected text, joining several selections', () => {
        const fake = fakeEditor(['hello world', 'second line'])
        const { result } = renderHook(() => useEditorCursor())
        act(() => {
            stop = trackEditorCursor(fake.editor)
        })

        fake.select({ startLineNumber: 1, startColumn: 7, endLineNumber: 2, endColumn: 7 })
        expect(result.current).toEqual({ line: 2, column: 7, selectedText: 'world\nsecond' })

        fake.select({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }, caret(2, 1), {
            startLineNumber: 2,
            startColumn: 8,
            endLineNumber: 2,
            endColumn: 12,
        })
        expect(result.current?.selectedText).toBe('hello\nline')
    })

    it('reads the selection again when the text under it changes', () => {
        const fake = fakeEditor(['hello world'])
        const { result } = renderHook(() => useEditorCursor())
        act(() => {
            stop = trackEditorCursor(fake.editor)
        })
        fake.select({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 })
        expect(result.current?.selectedText).toBe('hello')

        fake.setText(['howdy world'])
        expect(result.current?.selectedText).toBe('howdy')
    })

    it('keeps the same value while nothing it shows changed, so the status bar does not draw again', () => {
        const fake = fakeEditor(['hello'])
        const { result } = renderHook(() => useEditorCursor())
        act(() => {
            stop = trackEditorCursor(fake.editor)
        })
        const before = result.current
        fake.setText(['hello'])
        expect(result.current).toBe(before)
    })

    it('is unknown again once the editor has no file, is thrown away, or stops being tracked', () => {
        const { result } = renderHook(() => useEditorCursor())

        const noFile = fakeEditor(['a'])
        act(() => {
            stop = trackEditorCursor(noFile.editor)
        })
        noFile.detachModel()
        expect(result.current).toBeNull()

        const disposed = fakeEditor(['a'])
        act(() => {
            stop = trackEditorCursor(disposed.editor)
        })
        expect(result.current).not.toBeNull()
        disposed.dispose()
        expect(result.current).toBeNull()
        expect(disposed.listenerCount()).toBe(0)

        const stopped = fakeEditor(['a'])
        act(() => {
            stop = trackEditorCursor(stopped.editor)
        })
        act(() => stop?.())
        stop = undefined
        expect(result.current).toBeNull()
        expect(stopped.listenerCount()).toBe(0)
    })

    it('ignores an old editor once a newer one is tracked', () => {
        const older = fakeEditor(['old text'])
        const newer = fakeEditor(['new'])
        const { result } = renderHook(() => useEditorCursor())
        let stopOlder: () => void = () => {}
        act(() => {
            stopOlder = trackEditorCursor(older.editor)
            stop = trackEditorCursor(newer.editor)
        })
        newer.select(caret(1, 3))

        older.select(caret(1, 8))
        act(() => stopOlder())
        expect(result.current).toEqual({ line: 1, column: 3, selectedText: '' })
    })
})
