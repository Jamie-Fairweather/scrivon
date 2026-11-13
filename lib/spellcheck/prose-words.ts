import type { Nodes } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'

/** A word of prose and where it starts in the document (a UTF-16 offset, as Monaco counts). */
export type ProseWord = { word: string; offset: number }

const parser = unified().use(remarkParse).use(markdownRemarkPlugins)

/** Text between spaces. */
const CHUNK = /\S+/g
/** Letters, with apostrophes inside a word (don't, it’s) kept as part of it. */
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu
/**
 * A web address, email, file name or path, or a code name (snake_case), written as plain text:
 * not words to check. Also abbreviations with dots (e.g.).
 */
const NOT_PROSE = /:\/\/|@|[\\/_]|[\p{L}\p{N}]\.[\p{L}\p{N}]/u
/** HTML character references (&amp; &#169;), which stand for one character, not a word. */
const CHARACTER_REFERENCE = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi
/** A backslash that makes the next mark plain text (\*), which isn't part of any word. */
const ESCAPE = /\\(?=[!-/:-@[-`{-~])/g
/**
 * The label of a reference link (`[text][label]`) or a footnote (`[^label]`). A block is read on its own,
 * so one whose definition is in another block shows up as text. A footnote label's length is capped, so a
 * long run like [^[^[^ can't make the search slow.
 */
const REFERENCE_LABEL = /(?<=\]\[)[^\]\n]*(?=\])|(?<=\[)\^[^\]\s]{1,100}(?=\])/g
const DIGIT = /\p{N}/u

const blank = (text: string) => ' '.repeat(text.length)

function wordsIn(text: string, base: number, found: ProseWord[]): void {
    const plain = text.replace(CHARACTER_REFERENCE, blank).replace(ESCAPE, ' ').replace(REFERENCE_LABEL, blank)
    for (const chunk of plain.matchAll(CHUNK)) {
        if (NOT_PROSE.test(chunk[0])) continue
        for (const match of chunk[0].matchAll(WORD)) {
            const word = match[0]
            if (word.length < 2) continue
            // Part of 3rd, h2 or v1beta: not a word on its own.
            const before = chunk[0][match.index - 1] ?? ''
            const after = chunk[0][match.index + word.length] ?? ''
            if (DIGIT.test(before) || DIGIT.test(after)) continue
            found.push({ word, offset: base + chunk.index + match.index })
        }
    }
}

/** A link written as its own address (<https://…>, www.…, an email), whose text is that address. */
function isAutolink(node: Nodes): boolean {
    if (node.type !== 'link' || node.children.length !== 1) return false
    const child = node.children[0]!
    return child.type === 'text' && node.url.replace(/^(?:mailto:|https?:\/\/)/, '').endsWith(child.value.replace(/^(?:mailto:|https?:\/\/)/, ''))
}

/** The prose words of one block of Markdown, with offsets from its start. */
function wordsOfBlock(block: string): ProseWord[] {
    const found: ProseWord[] = []
    const visit = (node: Nodes) => {
        if (node.type === 'text') {
            const start = node.position?.start.offset
            const end = node.position?.end.offset
            if (start !== undefined && end !== undefined) wordsIn(block.slice(start, end), start, found)
            return
        }
        if (isAutolink(node)) return
        if ('children' in node) node.children.forEach(visit)
    }
    visit(parser.parse(block))
    return found
}

/** A line with its line break. */
const LINE = /[^\r\n]*(?:\r\n|\r|\n|$)/g
const BLANK_LINE = /^[ \t]*(?:\r\n|\r|\n)?$/
const INDENTED = /^[ \t]/
const FENCE = /^[ \t]*(`{3,}|~{3,})/
const CLOSING_FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:\r\n|\r|\n)?$/
/** HTML that runs on past blank lines, until its end tag (CommonMark's HTML blocks 1 and 2). */
const LONG_HTML = /^ {0,3}(?:<!--|<(pre|script|style|textarea)(?:[\s>]|$))/i

/** Where a block that runs on past blank lines ends: a closing fence, or the end of a comment or a <pre>. */
function closerFor(line: string): ((line: string) => boolean) | null {
    const fence = FENCE.exec(line)?.[1]
    if (fence) {
        return (next) => {
            const close = CLOSING_FENCE.exec(next)?.[1]
            return close !== undefined && close[0] === fence[0] && close.length >= fence.length
        }
    }
    const html = LONG_HTML.exec(line)
    if (!html) return null
    const end = html[1] ? `</${html[1].toLowerCase()}>` : '-->'
    if (line.slice(html[0].length).toLowerCase().includes(end)) return null
    return (next) => next.toLowerCase().includes(end)
}

/**
 * Splits Markdown at blank lines into blocks that read the same on their own, so a check after an
 * edit only has to read the blocks that changed. A fence, comment or <pre> stays in one block, and an
 * indented block stays with the one before it (the rest of a list item, or indented code).
 */
function splitBlocks(text: string): { text: string; offset: number }[] {
    const blocks: { start: number; end: number }[] = []
    let current: { start: number; end: number } | null = null
    let closes: ((line: string) => boolean) | null = null
    for (const match of text.matchAll(LINE)) {
        const line = match[0]
        if (line === '') break
        const end = match.index + line.length
        if (closes) {
            current!.end = end
            if (closes(line)) closes = null
            continue
        }
        if (BLANK_LINE.test(line)) {
            current = null
            continue
        }
        current ??= INDENTED.test(line) ? (blocks.at(-1) ?? null) : null
        if (current) current.end = end
        else {
            current = { start: match.index, end }
            blocks.push(current)
        }
        closes = closerFor(line)
    }
    return blocks.map(({ start, end }) => ({ text: text.slice(start, end), offset: start }))
}

/**
 * A reader of the words of a Markdown document's prose: the ones a spell check should look at. Code
 * (Mermaid diagrams too), link addresses, web addresses and emails, front matter and raw HTML are left
 * out. It remembers the blocks of the last document, so reading it again after an edit is quick.
 */
export function createProseWordFinder(): (markdown: string) => ProseWord[] {
    let known = new Map<string, ProseWord[]>()
    return (markdown) => {
        const body = parsePdfExportFrontMatter(markdown).body
        const bodyStart = markdown.length - body.length
        const found: ProseWord[] = []
        const seen = new Map<string, ProseWord[]>()
        for (const block of splitBlocks(body)) {
            const words = seen.get(block.text) ?? known.get(block.text) ?? wordsOfBlock(block.text)
            seen.set(block.text, words)
            const base = bodyStart + block.offset
            for (const { word, offset } of words) found.push({ word, offset: base + offset })
        }
        known = seen
        return found
    }
}

/** The words of a Markdown document's prose (see {@link createProseWordFinder}). */
export function findProseWords(markdown: string): ProseWord[] {
    return createProseWordFinder()(markdown)
}
