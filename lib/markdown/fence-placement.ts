import { insideCodeBlock } from '@/lib/markdown/code-blocks'

/**
 * Where a new fenced block (a ```mermaid diagram, say) goes in a Markdown file, from the line the caret is on.
 * On a blank line it takes that line. Otherwise it goes after the caret's line, so no text is split or replaced.
 * It has one blank line before and after it, unless one is already there or it is at the start or end of the file.
 */
export type FencePlacement = {
    /** The line it goes on, or after, from 0. */
    line: number
    /** True when it takes the place of that (blank) line. False when it goes after it. */
    replaceLine: boolean
    /** How many line breaks go before the block, counted from the place it goes in. */
    breaksBefore: number
    /** How many line breaks go after the block, before the line that follows it (whose own line break is already there). */
    breaksAfter: number
}

const isBlank = (line: string) => line.trim() === ''

/**
 * Where a fenced block goes for a caret on `caretLine` (from 0), or null when that place is inside a ``` or ~~~ code
 * block: on the fence that opens one, inside one, or on a line before the fence that closes one.
 */
export function placeFencedBlock(lineAt: (index: number) => string, lineCount: number, caretLine: number): FencePlacement | null {
    const line = Math.min(Math.max(caretLine, 0), lineCount - 1)
    const replaceLine = isBlank(lineAt(line))
    // The first line the block would sit on, as the file reads now.
    if (insideCodeBlock(lineAt, replaceLine ? line : line + 1)) return null
    const next = line + 1 < lineCount ? lineAt(line + 1) : null
    if (replaceLine) {
        const needsBlankBefore = line > 0 && !isBlank(lineAt(line - 1))
        return { line, replaceLine, breaksBefore: needsBlankBefore ? 1 : 0, breaksAfter: next !== null && !isBlank(next) ? 1 : 0 }
    }
    // After a line with text: a line break to end it, and a blank line.
    return { line, replaceLine, breaksBefore: 2, breaksAfter: next !== null && !isBlank(next) ? 1 : 0 }
}
