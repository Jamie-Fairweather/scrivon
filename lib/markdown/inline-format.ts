/**
 * Bold, italic, inline code and links for the Markdown editor. Each one toggles: run it on
 * formatted text and the formatting comes off. Works on plain text and character offsets, so
 * it knows nothing about the editor (lib/monaco/markdown-editing.ts applies the result).
 */

export type InlineStyle = 'bold' | 'italic' | 'code'

/** Character offsets into the text, start <= end. */
export type TextRange = { start: number; end: number }

/** Replace the text between start and end (offsets in the text before any edit) with `text`. */
export type TextEdit = { start: number; end: number; text: string }

/** The edits to make, and where the selections go in the text after them. */
export type FormatResult = { edits: TextEdit[]; selections: TextRange[] }

/** One selection's edits, and its selection after them (counting only its own edits). */
type Change = { edits: TextEdit[]; selection: TextRange }

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u

function isWordChar(char: string | undefined): boolean {
    return char !== undefined && WORD_CHAR.test(char)
}

/** The word the caret is in or touches, or null when it's between spaces or punctuation. */
function wordAt(text: string, offset: number): TextRange | null {
    let start = offset
    let end = offset
    while (start > 0 && isWordChar(text[start - 1])) start -= 1
    while (end < text.length && isWordChar(text[end])) end += 1
    return start === end ? null : { start, end }
}

/** The selection without spaces or line breaks at its ends, which can't sit inside the markers. */
function trimmed(text: string, range: TextRange): TextRange {
    let { start, end } = range
    while (start < end && /\s/.test(text[start])) start += 1
    while (end > start && /\s/.test(text[end - 1])) end -= 1
    return { start, end }
}

/** How many `char` there are in a row going back from `offset` (step -1) or forward from it (step 1), up to `max`. */
function runLength(text: string, offset: number, char: string, step: 1 | -1, max = Infinity): number {
    let count = 0
    let index = step === 1 ? offset : offset - 1
    while (count < max && index >= 0 && index < text.length && text[index] === char) {
        count += 1
        index += step
    }
    return count
}

/** Moves a range by the edits made before it. */
function shift(range: TextRange, by: number): TextRange {
    return { start: range.start + by, end: range.end + by }
}

/**
 * Where the selection ends up once markers go on or come off: `before` is how far the text moves,
 * `inside` how much the selected part grows or shrinks. A caret that was inside a word keeps its
 * place in the word; a selection keeps the same text selected.
 */
function after(selection: TextRange, target: TextRange, before: number, inside: number): TextRange {
    if (selection.start === selection.end && target.start !== target.end) return shift(selection, before)
    return { start: target.start + before, end: target.end + before + inside }
}

function remove(start: number, end: number): TextEdit {
    return { start, end, text: '' }
}

function insert(at: number, text: string): TextEdit {
    return { start: at, end: at, text }
}

/** Puts `open` before the range and `close` after it: one edit when the range is empty, so they can't swap places. */
function wrap(range: TextRange, open: string, close: string): TextEdit[] {
    if (range.start === range.end) return [insert(range.start, open + close)]
    return [insert(range.start, open), insert(range.end, close)]
}

/** Bold is on with two or more markers each side; italic with one, or three or more (bold italic). */
function hasEmphasis(markers: number, level: 1 | 2): boolean {
    return level === 2 ? markers >= 2 : markers === 1 || markers >= 3
}

/** Bold (level 2) or italic (level 1) on or off, for one selection. */
function toggleEmphasis(text: string, selection: TextRange, target: TextRange, level: 1 | 2): Change {
    const { start, end } = target
    for (const char of ['*', '_']) {
        const markers = Math.min(runLength(text, start, char, -1), runLength(text, end, char, 1))
        if (hasEmphasis(markers, level)) {
            return {
                edits: [remove(start - level, start), remove(end, end + level)],
                selection: after(selection, target, -level, 0),
            }
        }
    }
    const half = Math.floor((end - start) / 2)
    for (const char of ['*', '_']) {
        const markers = Math.min(runLength(text, start, char, 1, half), runLength(text, end, char, -1, half))
        if (hasEmphasis(markers, level)) {
            return {
                edits: [remove(start, start + level), remove(end - level, end)],
                selection: after(selection, target, 0, -2 * level),
            }
        }
    }
    const marker = '*'.repeat(level)
    return { edits: wrap(target, marker, marker), selection: after(selection, target, level, 0) }
}

/** The backticks around a code span, with the space that pads code starting or ending with a backtick. */
function codeFence(text: string, start: number, end: number): { size: number; padded: boolean } | null {
    const plain = Math.min(runLength(text, start, '`', -1), runLength(text, end, '`', 1))
    if (plain > 0) return { size: plain, padded: false }
    if (text[start - 1] !== ' ' || text[end] !== ' ') return null
    const padded = Math.min(runLength(text, start - 1, '`', -1), runLength(text, end + 1, '`', 1))
    return padded > 0 ? { size: padded, padded: true } : null
}

/** Inline code on or off, for one selection. Code with backticks in it gets a longer fence. */
function toggleCode(text: string, selection: TextRange, target: TextRange): Change {
    const { start, end } = target
    const outside = codeFence(text, start, end)
    if (outside) {
        const width = outside.size + (outside.padded ? 1 : 0)
        return { edits: [remove(start - width, start), remove(end, end + width)], selection: after(selection, target, -width, 0) }
    }

    const inner = /^(`+)( ?)([\s\S]*?)\2\1$/.exec(text.slice(start, end))
    if (inner && inner[3].length > 0) {
        const width = inner[1].length + inner[2].length
        return { edits: [remove(start, start + width), remove(end - width, end)], selection: after(selection, target, 0, -2 * width) }
    }

    const content = text.slice(start, end)
    const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(longest + 1)
    const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
    return {
        edits: wrap(target, fence + pad, pad + fence),
        selection: after(selection, target, fence.length + pad.length, 0),
    }
}

/** The text to format for a selection: the selection less its outer spaces, or the word at a caret. */
function targetOf(text: string, selection: TextRange): TextRange {
    if (selection.start !== selection.end) return trimmed(text, selection)
    return wordAt(text, selection.start) ?? selection
}

/**
 * Runs `one` for each selection, in order through the text, and puts the results together. A
 * selection whose edits would overlap an earlier one's (two carets in one word) is dropped.
 */
function forEachSelection(selections: readonly TextRange[], one: (selection: TextRange) => Change): FormatResult {
    const edits: TextEdit[] = []
    const moved: TextRange[] = []
    let delta = 0
    let reached = -1
    for (const selection of [...selections].sort((a, b) => a.start - b.start)) {
        const change = one(selection)
        if (change.edits.some((edit) => edit.start < reached)) continue
        edits.push(...change.edits)
        moved.push(shift(change.selection, delta))
        for (const edit of change.edits) {
            delta += edit.text.length - (edit.end - edit.start)
            reached = Math.max(reached, edit.end)
        }
    }
    return { edits, selections: moved }
}

/** Turns bold, italic or inline code on for each selection, or off where it's already on. */
export function toggleInlineStyle(text: string, selections: readonly TextRange[], style: InlineStyle): FormatResult {
    return forEachSelection(selections, (selection) => {
        const target = targetOf(text, selection)
        if (style === 'code') return toggleCode(text, selection, target)
        return toggleEmphasis(text, selection, target, style === 'bold' ? 2 : 1)
    })
}

const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g
const WEB_ADDRESS = /^(?:https?:\/\/|mailto:|www\.)\S+$/i

/** The link (not an image) the range sits in, with where its text is. */
function linkAround(text: string, range: TextRange): { start: number; end: number; label: string } | null {
    const lineStart = text.lastIndexOf('\n', range.start - 1) + 1
    const lineEndAt = text.indexOf('\n', range.end)
    const line = text.slice(lineStart, lineEndAt === -1 ? text.length : lineEndAt)
    for (const match of line.matchAll(LINK)) {
        const start = lineStart + match.index
        const end = start + match[0].length
        if (text[start - 1] === '!') continue
        if (range.start >= start && range.end <= end) return { start, end, label: match[1] }
    }
    return null
}

/**
 * Makes each selection a link, or takes the link off when the selection is in one. The caret goes
 * where the user types next: the address, or the text when the selection was a web address.
 */
export function toggleLink(text: string, selections: readonly TextRange[]): FormatResult {
    return forEachSelection(selections, (selection) => {
        const existing = linkAround(text, selection)
        if (existing) {
            return {
                edits: [{ start: existing.start, end: existing.end, text: existing.label }],
                selection: { start: existing.start, end: existing.start + existing.label.length },
            }
        }

        const target = targetOf(text, selection)
        const content = text.slice(target.start, target.end)
        if (WEB_ADDRESS.test(content)) {
            const caret = target.start + 1
            return { edits: wrap(target, '[](', ')'), selection: { start: caret, end: caret } }
        }
        // An empty link waits for its text; otherwise the address comes next.
        const caret = target.start === target.end ? target.start + 1 : target.end + 3
        return { edits: wrap(target, '[', ']()'), selection: { start: caret, end: caret } }
    })
}
