/**
 * Enter in a Markdown list: continue the list, or end it on an empty item. Works on lines of
 * plain text (lib/monaco/markdown-editing.ts hooks it up to the editor).
 */

/** Replace columns `from` to `to` of the caret's line (0-based) with `text`; the caret goes after it. */
export type LineEdit = { from: number; to: number; text: string }

// Indent, bullet or number, the space after it, then a task box if there is one.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\](?:[ \t]+|$))?(.*)$/
// A line of three or more - * or _ (spaces allowed between) is a divider, not a list.
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** Whether the line sits inside a ``` or ~~~ code block that starts above it. */
function insideCodeBlock(lineAt: (index: number) => string, lineIndex: number): boolean {
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

/** The marker for the next item: the same bullet, or the next number. */
function nextMarker(marker: string): string {
    const number = /^(\d+)([.)])$/.exec(marker)
    return number ? `${Number(number[1]) + 1}${number[2]}` : marker
}

/**
 * What Enter does with the caret at `column` of line `lineIndex`, or null to leave it to the
 * editor. After a list item's marker it starts a new item (a new task is unticked); on an empty
 * item it clears the line, which ends the list.
 */
export function listEnter(lineAt: (index: number) => string, lineIndex: number, column: number): LineEdit | null {
    const line = lineAt(lineIndex)
    const item = LIST_ITEM.exec(line)
    if (!item || THEMATIC_BREAK.test(line)) return null

    const [, indent, marker, space, task = '', content] = item
    if (column < indent.length + marker.length + space.length + task.length) return null
    if (insideCodeBlock(lineAt, lineIndex)) return null

    if (content.trim() === '') return { from: 0, to: line.length, text: '' }
    return { from: column, to: column, text: `\n${indent}${nextMarker(marker)}${space}${task ? '[ ] ' : ''}` }
}
