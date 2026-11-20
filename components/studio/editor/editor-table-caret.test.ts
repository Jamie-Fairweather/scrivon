import { describe, expect, it, vi } from 'vitest'
import { trackCaretInTable, type TableCaretSource } from '@/components/studio/editor/editor-table-caret'

/** An editor on a file of `lines`, counting each line it reads. */
function fakeEditor(lines: string[]) {
    const read: number[] = []
    const cursorListeners: (() => void)[] = []
    const modelListeners: (() => void)[] = []
    const contentListeners: (() => void)[] = []
    let position = { lineNumber: 1, column: 1 }
    const model = {
        getLineContent: (lineNumber: number) => {
            read.push(lineNumber)
            return lines[lineNumber - 1]
        },
        getLineCount: () => lines.length,
    }
    const source = {
        getModel: () => model,
        getPosition: () => position,
        onDidChangeCursorPosition: (listener: () => void) => {
            cursorListeners.push(listener)
            return { dispose: () => cursorListeners.splice(cursorListeners.indexOf(listener), 1) }
        },
        onDidChangeModel: (listener: () => void) => {
            modelListeners.push(listener)
            return { dispose: () => modelListeners.splice(modelListeners.indexOf(listener), 1) }
        },
        onDidChangeModelContent: (listener: () => void) => {
            contentListeners.push(listener)
            return { dispose: () => contentListeners.splice(contentListeners.indexOf(listener), 1) }
        },
    }
    const moveTo = (lineNumber: number) => {
        position = { lineNumber, column: 1 }
        read.length = 0
        cursorListeners.forEach((listener) => listener())
    }
    /** An edit that leaves the caret where it is, as Replace All or a restore from Local History can. */
    const replaceLines = (lineNumber: number, replacement: string[]) => {
        lines.splice(lineNumber - 1, replacement.length, ...replacement)
        read.length = 0
        contentListeners.forEach((listener) => listener())
    }
    return { source: source as unknown as TableCaretSource, read, moveTo, replaceLines, cursorListeners, modelListeners, contentListeners }
}

/** 50,000 lines of prose with a table at lines 25,001 to 25,004 (from 1). */
function bigFile(): string[] {
    const lines = Array.from({ length: 50_000 }, (_, index) => `Line ${index + 1} of prose.`)
    lines.splice(25_000, 4, '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |')
    // A code fence near the top, which the caret check must never read down to.
    lines[0] = '```'
    lines[1] = '```'
    return lines
}

describe('trackCaretInTable', () => {
    it('reads only the caret’s line in a 50,000-line file when it has no pipe', () => {
        const editor = fakeEditor(bigFile())
        trackCaretInTable(editor.source, () => true, vi.fn())

        editor.moveTo(10_000)

        expect(editor.read).toEqual([10_000])
    })

    it('reads only the table and the line each side as the caret moves in it, and never looks for code blocks', () => {
        const editor = fakeEditor(bigFile())
        const onChange = vi.fn()
        trackCaretInTable(editor.source, () => true, onChange)

        editor.moveTo(25_003)

        expect([...editor.read].sort((a, b) => a - b)).toEqual([25_000, 25_001, 25_002, 25_003, 25_004, 25_005])
        expect(onChange).toHaveBeenCalledWith(true)
    })

    it('says only when the answer changes', () => {
        const editor = fakeEditor(bigFile())
        const onChange = vi.fn()
        trackCaretInTable(editor.source, () => true, onChange)

        editor.moveTo(25_001)
        editor.moveTo(25_002)
        editor.moveTo(25_004)
        editor.moveTo(30_000)
        editor.moveTo(30_001)

        expect(onChange.mock.calls).toEqual([[true], [false]])
    })

    it('says no outside Markdown files, without reading the file', () => {
        const editor = fakeEditor(bigFile())
        const onChange = vi.fn()
        trackCaretInTable(editor.source, () => false, onChange)

        editor.moveTo(25_001)

        expect(editor.read).toEqual([])
        expect(onChange).not.toHaveBeenCalled()
    })

    it('looks at once and when another file shows, and stops when disposed', () => {
        const editor = fakeEditor(['| a |', '| - |'])
        const onChange = vi.fn()
        let markdown = true
        const tracking = trackCaretInTable(editor.source, () => markdown, onChange)
        expect(onChange).toHaveBeenCalledWith(true)

        markdown = false
        editor.modelListeners.forEach((listener) => listener())
        expect(onChange).toHaveBeenLastCalledWith(false)

        tracking.dispose()

        expect(editor.cursorListeners).toHaveLength(0)
        expect(editor.modelListeners).toHaveLength(0)
        expect(editor.contentListeners).toHaveLength(0)
    })

    it('looks again when the text changes under a caret that stays put', () => {
        const editor = fakeEditor(['Intro', 'one', 'two', 'three', 'end'])
        const onChange = vi.fn()
        trackCaretInTable(editor.source, () => true, onChange)
        editor.moveTo(3)

        editor.replaceLines(2, ['| a | b |', '|---|---|', '| 1 | 2 |'])
        expect(onChange).toHaveBeenLastCalledWith(true)

        editor.replaceLines(2, ['one', 'two', 'three'])
        expect(onChange).toHaveBeenLastCalledWith(false)
        // Still cheap: a caret line with no pipe is the only line it reads.
        expect(editor.read).toEqual([3])
    })
})
