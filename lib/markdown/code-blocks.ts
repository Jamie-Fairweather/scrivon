/**
 * Code blocks in Markdown, read line by line. Shared by the editing helpers (list continuation, the
 * table helpers…), which leave text inside a code block alone.
 */

// Any indent, as a code block in a nested list item is indented with it. A ``` line with another
// backtick after it is inline code, not a fence.
const CODE_FENCE = /^\s*(`{3,}(?!.*`)|~{3,})(.*)$/

/** Whether the line opens or closes a ``` or ~~~ code block. */
export function isCodeFence(line: string): boolean {
    return CODE_FENCE.test(line)
}

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

/** The line's leading spaces and tabs as columns, a tab going on to the next multiple of 4 as in CommonMark. */
export function indentWidth(line: string): number {
    let width = 0
    for (const character of line) {
        if (character === ' ') width += 1
        else if (character === '\t') width += 4 - (width % 4)
        else break
    }
    return width
}

// A list item's marker, and the spaces after it, which an empty item doesn't need.
const LIST_MARKER = /^ *(?:[-*+]|\d{1,9}[.)])(?:( +)|$)/
const isBlank = (line: string) => line.trim() === ''

/** The column a list item's text starts at, or null when the line isn't a list item. */
function listItemContent(line: string): number | null {
    const expanded = line.replace(/^[ \t]+/, (indent) => ' '.repeat(indentWidth(indent))).replace(/\t/g, '    ')
    const marker = LIST_MARKER.exec(expanded)
    if (!marker) return null
    const spaces = marker[1]?.length ?? 0
    // With no text, or 5 or more spaces (the text is then indented code), the text starts one space on.
    const oneSpace = spaces === 0 || spaces > 4 || isBlank(expanded.slice(marker[0].length))
    return marker[0].length - spaces + (oneSpace ? 1 : spaces)
}

/**
 * Whether the line is in an indented code block: indented 4 or more columns past the text of the list
 * item it's in (past the margin outside a list), after a blank line or more code. Reads up from the
 * line until it finds the list item it's in, or a line back at the margin. It doesn't know about block
 * quotes, or lazy lines that carry a list item's paragraph on without its indent.
 */
export function insideIndentedCode(lineAt: (index: number) => string, lineIndex: number): boolean {
    const indent = indentWidth(lineAt(lineIndex))
    if (indent < 4) return false

    // The list item the line is in: the nearest one above whose text no line since is left of.
    let container = 0
    let left = indent
    for (let index = lineIndex - 1; index >= 0 && left > 0; index -= 1) {
        const line = lineAt(index)
        if (isBlank(line)) continue
        const content = listItemContent(line)
        if (content !== null && content <= left) {
            container = content
            break
        }
        left = Math.min(left, indentWidth(line))
    }
    if (indent - container < 4) return false

    // Code can't carry a paragraph on, so it starts after a blank line (or the start of the file).
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
        const line = lineAt(index)
        if (isBlank(line)) return true
        if (indentWidth(line) - container < 4) return false
    }
    return true
}
