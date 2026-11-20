/** A selection or cursor, in Monaco's 1-based lines and columns, its start before its end (as Monaco's are). */
export type LineSelection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** Lines `start` to `end`, both included (1-based). */
export type LineSpan = { start: number; end: number }

/** A line with nothing on it but spaces: what separates paragraphs. */
export function isBlankLine(text: string): boolean {
    return text.trim() === ''
}

/**
 * The lines a selection really covers. One that ends at the very start of a line (as selecting whole lines does)
 * stops on the line before.
 */
function selectedLines({ startLineNumber, endLineNumber, endColumn }: LineSelection): LineSpan {
    const end = endLineNumber > startLineNumber && endColumn === 1 ? endLineNumber - 1 : endLineNumber
    return { start: startLineNumber, end }
}

/**
 * The paragraphs the cursors and selections are in, as one span from the first paragraph's first line to the
 * last one's last line. A paragraph is a run of lines between blank lines; a cursor on a blank line has that
 * line alone. Only the lines around the edges are read, so a long file costs no more than a short one.
 */
export function focusedLines(lineCount: number, lineText: (line: number) => string, selections: readonly LineSelection[]): LineSpan | null {
    if (lineCount < 1 || selections.length === 0) return null
    const clamp = (line: number) => Math.min(lineCount, Math.max(1, line))
    let start = lineCount
    let end = 1
    for (const selection of selections) {
        const lines = selectedLines(selection)
        start = Math.min(start, clamp(lines.start))
        end = Math.max(end, clamp(lines.end))
    }
    // Out to the blank lines around the first and last selected lines (no further when they are blank).
    if (!isBlankLine(lineText(start))) while (start > 1 && !isBlankLine(lineText(start - 1))) start--
    if (!isBlankLine(lineText(end))) while (end < lineCount && !isBlankLine(lineText(end + 1))) end++
    return { start, end }
}

/** The lines to dim: at most two spans, everything above the focused paragraphs and everything below them. */
export function dimmedLineSpans(lineCount: number, focused: LineSpan | null): LineSpan[] {
    if (!focused) return []
    const spans: LineSpan[] = []
    if (focused.start > 1) spans.push({ start: 1, end: focused.start - 1 })
    if (focused.end < lineCount) spans.push({ start: focused.end + 1, end: lineCount })
    return spans
}
