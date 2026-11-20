/**
 * Fenced code blocks in Markdown, read line by line. Shared by the editing helpers (list continuation,
 * the table helpers…), which leave text inside a code block alone.
 */

// Any indent, as a code block in a nested list item is indented with it. A ``` line with another
// backtick after it is inline code, not a fence.
const CODE_FENCE = /^\s*(`{3,}(?!.*`)|~{3,})(.*)$/

/** Whether the line sits inside a ``` or ~~~ code block that starts above it. Reads every line above it. */
export function insideCodeBlock(lineAt: (index: number) => string, lineIndex: number): boolean {
    let open: string | null = null
    for (let index = 0; index < lineIndex; index += 1) {
        const fence = CODE_FENCE.exec(lineAt(index))
        if (!fence) continue
        const [, marks, rest] = fence
        if (open === null) open = marks
        // Closed by the same kind of fence, at least as long, with nothing after it.
        else if (marks[0] === open[0] && marks.length >= open.length && rest.trim() === '') open = null
    }
    return open !== null
}
