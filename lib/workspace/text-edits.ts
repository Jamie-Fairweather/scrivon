/**
 * Edits to a document's text as ranges, the way Monaco counts them: lines and columns from 1, with the end
 * left out of the range. A line ends at `\r\n`, `\r` or `\n`, each one break, so a range means the same text
 * in the editor's buffer (which uses one kind of line break) and in the tab's text (which keeps the file's).
 *
 * The coordinator's applyTabEdits takes these (workspace-coordinator.ts), so a restore, a link update or a
 * replace across the workspace changes an open tab as one undo step.
 */

export type TextRange = {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
}

/** Puts `text` in place of what `range` covers (an empty range inserts it). */
export type TextEdit = { range: TextRange; text: string }

/** Where each line starts in `text`, and where its text ends (before its line break). */
function lineSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = []
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char !== '\n' && char !== '\r') continue
        spans.push({ start, end: i })
        if (char === '\r' && text[i + 1] === '\n') i++
        start = i + 1
    }
    spans.push({ start, end: text.length })
    return spans
}

/** The offset in `text` of a line and column, moved inside the text as Monaco does with one past its end. */
function offsetIn(spans: ReadonlyArray<{ start: number; end: number }>, line: number, column: number): number {
    const span = spans[Math.min(Math.max(1, Math.floor(line)), spans.length) - 1]!
    return span.start + Math.min(Math.max(1, Math.floor(column)), span.end - span.start + 1) - 1
}

/** The range that covers all of `text`. */
export function wholeTextRange(text: string): TextRange {
    const spans = lineSpans(text)
    const last = spans[spans.length - 1]!
    return { startLineNumber: 1, startColumn: 1, endLineNumber: spans.length, endColumn: last.end - last.start + 1 }
}

/** The range from offset `start` to offset `end` in `text`. */
export function rangeOfOffsets(text: string, start: number, end: number): TextRange {
    const spans = lineSpans(text)
    const at = (offset: number) => {
        const clamped = Math.min(Math.max(0, offset), text.length)
        // The last line starting at or before it. An offset inside a line break is the end of its line.
        let line = 0
        while (line + 1 < spans.length && spans[line + 1]!.start <= clamped) line++
        const span = spans[line]!
        return { line: line + 1, column: Math.min(clamped, span.end) - span.start + 1 }
    }
    const from = at(start)
    const to = at(Math.max(start, end))
    return { startLineNumber: from.line, startColumn: from.column, endLineNumber: to.line, endColumn: to.column }
}

/**
 * `text` with every edit made, each range read in the text as it was before any of them. Ranges past the end
 * are moved inside it, as Monaco does. Throws when two ranges overlap, as Monaco's edits do.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
    const spans = lineSpans(text)
    const placed = edits
        .map((edit) => {
            const { startLineNumber, startColumn, endLineNumber, endColumn } = edit.range
            const a = offsetIn(spans, startLineNumber, startColumn)
            const b = offsetIn(spans, endLineNumber, endColumn)
            return { start: Math.min(a, b), end: Math.max(a, b), text: edit.text }
        })
        .sort((a, b) => a.start - b.start || a.end - b.end)
    for (let i = 1; i < placed.length; i++) {
        if (placed[i]!.start < placed[i - 1]!.end) throw new Error('Edits to a document must not overlap.')
    }
    let result = ''
    let from = 0
    for (const edit of placed) {
        result += text.slice(from, edit.start) + edit.text
        from = edit.end
    }
    return result + text.slice(from)
}
