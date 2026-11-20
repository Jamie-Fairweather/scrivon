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

// A block quote's marker: up to 3 spaces, `>`, and the one space after it, which is part of the marker.
const QUOTE_MARKER = /^ {0,3}> ?/

/** The line's block quote markers, up to `most` of them: how many, and the text after them. */
function unquote(line: string, most: number): { depth: number; text: string } {
    let depth = 0
    let text = line
    while (depth < most) {
        const marker = QUOTE_MARKER.exec(text)
        if (!marker) break
        text = text.slice(marker[0].length)
        depth += 1
    }
    return { depth, text }
}

/**
 * Whether the line sits inside a ``` or ~~~ code block that starts above it, in a block quote or not. Reads every
 * line above it, and never the line itself (which may be one past the end of the file).
 */
export function insideCodeBlock(lineAt: (index: number) => string, lineIndex: number): boolean {
    // The open block's fence, and how many block quotes it is in.
    let open: { marks: string; depth: number } | null = null
    for (let index = 0; index < lineIndex; index += 1) {
        const line = lineAt(index)
        if (open !== null) {
            // Inside the block, only its own quote markers come off: a quoted fence in an unquoted block is code.
            const inner = unquote(line, open.depth)
            if (inner.depth === open.depth) {
                const fence = CODE_FENCE.exec(inner.text)
                // Closed by the same kind of fence, at least as long, with nothing after it.
                if (fence && fence[1][0] === open.marks[0] && fence[1].length >= open.marks.length && fence[2].trim() === '') open = null
                continue
            }
            // Fewer quote markers: the quote the block was in has ended, and the block with it.
            open = null
        }
        const outer = unquote(line, Infinity)
        const fence = CODE_FENCE.exec(outer.text)
        if (fence) open = { marks: fence[1], depth: outer.depth }
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
