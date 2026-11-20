import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import { DIMMED_TEXT_CLASS, bindParagraphDimming } from './editor-paragraph-dimming'

type Listener = () => void

/** Just enough of a Monaco editor: its text, its selections, its events and one decorations collection. */
function fakeEditor(lines: string[]) {
    const listeners = { cursor: [] as Listener[], content: [] as Listener[], model: [] as Listener[] }
    const on = (list: Listener[]) => (listener: Listener) => {
        list.push(listener)
        return { dispose: () => list.splice(list.indexOf(listener), 1) }
    }
    const state = {
        lines,
        selections: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }],
        decorations: [] as editor.IModelDeltaDecoration[],
    }
    const model = {
        getLineCount: () => state.lines.length,
        getLineContent: (line: number) => state.lines[line - 1]!,
        getLineMaxColumn: (line: number) => state.lines[line - 1]!.length + 1,
    }
    const codeEditor = {
        getModel: () => model,
        getSelections: () => state.selections,
        createDecorationsCollection: () => ({
            set: (next: editor.IModelDeltaDecoration[]) => {
                state.decorations = next
            },
            clear: () => {
                state.decorations = []
            },
        }),
        onDidChangeCursorSelection: on(listeners.cursor),
        onDidChangeModelContent: on(listeners.content),
        onDidChangeModel: on(listeners.model),
    }
    const fire = (list: Listener[]) => list.forEach((listener) => listener())
    return { codeEditor: codeEditor as unknown as editor.ICodeEditor, state, listeners, fire }
}

const TEXT = ['First paragraph,', 'still the first.', '', 'Second.', '', 'Third.']

/** The faded line spans, as [first line, last line]. */
function faded(decorations: editor.IModelDeltaDecoration[]) {
    return decorations.map(({ range }) => [range.startLineNumber, range.endLineNumber])
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
})

afterEach(() => {
    vi.useRealTimers()
})

describe('bindParagraphDimming', () => {
    it('fades every line but the paragraph the cursor is in, the text only', () => {
        const { codeEditor, state } = fakeEditor([...TEXT])
        bindParagraphDimming(codeEditor, () => true)

        expect(faded(state.decorations)).toEqual([[3, 6]])
        expect(state.decorations[0]!.range).toMatchObject({ startColumn: 1, endColumn: 7 })
        expect(state.decorations[0]!.options).toMatchObject({ inlineClassName: DIMMED_TEXT_CLASS })
        // Not a line or margin class, which would cover the selection and find highlights.
        expect(state.decorations[0]!.options.className).toBeUndefined()
        expect(state.decorations[0]!.options.isWholeLine).toBeUndefined()
    })

    it('follows the cursor and the text, once a frame', () => {
        const { codeEditor, state, listeners, fire } = fakeEditor([...TEXT])
        bindParagraphDimming(codeEditor, () => true)

        state.selections = [{ startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 2 }]
        fire(listeners.cursor)
        fire(listeners.cursor)
        expect(faded(state.decorations)).toEqual([[3, 6]])
        vi.advanceTimersToNextFrame()
        expect(faded(state.decorations)).toEqual([
            [1, 3],
            [5, 6],
        ])

        // Typing joins the second paragraph to the third.
        state.lines.splice(4, 1)
        fire(listeners.content)
        vi.advanceTimersToNextFrame()
        expect(faded(state.decorations)).toEqual([[1, 3]])
    })

    it('fades nothing while switched off, and catches up when switched on', () => {
        let on = false
        const { codeEditor, state } = fakeEditor([...TEXT])
        const dimming = bindParagraphDimming(codeEditor, () => on)
        expect(state.decorations).toEqual([])

        on = true
        dimming.refresh()
        vi.advanceTimersToNextFrame()
        expect(faded(state.decorations)).toEqual([[3, 6]])

        on = false
        dimming.refresh()
        vi.advanceTimersToNextFrame()
        expect(state.decorations).toEqual([])
    })

    it('stops and takes its fading away when disposed', () => {
        const { codeEditor, state, listeners, fire } = fakeEditor([...TEXT])
        const dimming = bindParagraphDimming(codeEditor, () => true)

        dimming.dispose()
        expect(state.decorations).toEqual([])
        expect(listeners.cursor).toHaveLength(0)
        fire(listeners.content)
        vi.advanceTimersToNextFrame()
        expect(state.decorations).toEqual([])
    })
})
