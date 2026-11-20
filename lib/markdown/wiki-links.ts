import type { Nodes, Parent, PhrasingContent, Root, Text } from 'mdast'
import type { Point, Position } from 'unist'
import type { VFile } from 'vfile'
import { headingSlug } from '@/lib/markdown/export-outline'

/**
 * Wiki links: `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`, `[[folder/Note]]` and `[[#Heading]]`. Pure (no
 * DOM, React or Tauri), so every worker that reads Markdown can load it. Which file a link leads to is worked out
 * apart, from the open folder's tree (lib/workspace/wiki-link-lookup.ts).
 */

/** A wiki link in the syntax tree. Its one child is the text it shows: its label, or else the note's name. */
export interface WikiLink extends Parent {
    type: 'wikiLink'
    /** The note, as written (`folder/Note`, `Note.md`), without its `#heading` or label. Empty for `[[#Heading]]`. */
    target: string
    /** The heading after `#`, as written, or null. */
    heading: string | null
    /** The text after `|`, or null when the link has none. */
    label: string | null
    children: PhrasingContent[]
}

declare module 'mdast' {
    interface PhrasingContentMap {
        wikiLink: WikiLink
    }
    interface RootContentMap {
        wikiLink: WikiLink
    }
}

/** The class the preview, the export and the sanitizer know a wiki link by. */
export const WIKI_LINK_CLASS = 'wiki-link'

/** `[[` then anything but brackets and line breaks, then `]]`. */
const WIKI_LINK = /\[\[([^[\]\n\r]+)\]\]/g
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
/** A character reference as CommonMark reads one: `&amp;`, `&#35;`, `&#x23;`. */
const CHARACTER_REFERENCE = /&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{1,31});/y

/** What is written between the brackets, read apart. Offsets are from the start of that text. */
export type WikiLinkParts = {
    target: string
    heading: string | null
    label: string | null
    /** Where the shown text is written: the label, or else the target and heading. */
    shown: { start: number; end: number }
}

/** Where `part` starts and ends in `text` from `from`, without the spaces around it. */
function trimmedSpan(text: string, from: number, to: number): { start: number; end: number } {
    let start = from
    let end = to
    while (start < end && /\s/.test(text[start]!)) start += 1
    while (end > start && /\s/.test(text[end - 1]!)) end -= 1
    return { start, end }
}

/**
 * Reads the text between `[[` and `]]`: the target up to `#` or `|`, the heading after `#`, the label after `|`.
 * Null when it names neither a note nor a heading (`[[ ]]`, `[[#]]`).
 */
export function parseWikiLinkText(inner: string): WikiLinkParts | null {
    const pipe = inner.indexOf('|')
    const destinationEnd = pipe >= 0 ? pipe : inner.length
    const hash = inner.slice(0, destinationEnd).indexOf('#')
    const targetSpan = trimmedSpan(inner, 0, hash >= 0 ? hash : destinationEnd)
    const target = inner.slice(targetSpan.start, targetSpan.end)
    const headingSpan = hash >= 0 ? trimmedSpan(inner, hash + 1, destinationEnd) : null
    const heading = headingSpan ? inner.slice(headingSpan.start, headingSpan.end) || null : null
    if (!target && !heading) return null
    const labelSpan = pipe >= 0 ? trimmedSpan(inner, pipe + 1, inner.length) : null
    const label = labelSpan ? inner.slice(labelSpan.start, labelSpan.end) || null : null
    const destination = trimmedSpan(inner, 0, destinationEnd)
    return { target, heading, label, shown: label ? labelSpan! : destination }
}

/** The text a wiki link shows: its label, else the note's name (with the heading after it), else the heading. */
export function wikiLinkText({ target, heading, label }: Pick<WikiLink, 'target' | 'heading' | 'label'>): string {
    if (label) return label
    if (!target) return heading ?? ''
    return heading ? `${target} › ${heading}` : target
}

/**
 * Where a `[[#Heading]]` link points in its own document: the heading's id as the preview and the export give it
 * (`#getting-started`), so the export's links and Word's bookmarks reach it as a `#getting-started` link would.
 */
export function wikiHeadingHref(heading: string): string {
    return `#${headingSlug(heading)}`
}

/**
 * Where each character of a text node's `value` is written in `raw` (the source of the node), and one more for its end.
 * The value leaves out what the source has around the words: backslash escapes, character references, a quote's `>`
 * and the indent and trailing spaces of each line. A character that can't be matched up keeps the last place found.
 */
function alignWithSource(value: string, raw: string): number[] {
    const map: number[] = new Array<number>(value.length + 1)
    let i = 0
    let j = 0
    while (j < value.length) {
        const c = value[j]!
        if (raw[i] === '\\' && i + 1 < raw.length && ASCII_PUNCTUATION.test(raw[i + 1]!) && raw[i + 1] === c) {
            map[j] = i
            i += 2
            j += 1
            continue
        }
        if (raw[i] === '&' && c !== '&') {
            CHARACTER_REFERENCE.lastIndex = i
            const reference = CHARACTER_REFERENCE.exec(raw)
            if (reference) {
                map[j] = i
                // A character outside the Basic Multilingual Plane is two UTF-16 units.
                if (/[\uD800-\uDBFF]/.test(c) && j + 1 < value.length) map[++j] = i
                i += reference[0].length
                j += 1
                continue
            }
        }
        if (raw[i] === c) {
            map[j] = i
            i += 1
            j += 1
        } else if (i < raw.length) {
            i += 1
        } else {
            map[j] = raw.length
            j += 1
        }
    }
    map[value.length] = Math.min(i, raw.length)
    return map
}

/** The point `index` characters into `raw`, which starts at `start`. */
function pointIn(raw: string, start: Point, index: number): Point {
    let lines = 0
    let lastBreak = -1
    for (let k = raw.indexOf('\n'); k !== -1 && k < index; k = raw.indexOf('\n', k + 1)) {
        lines += 1
        lastBreak = k
    }
    return {
        line: start.line + lines,
        column: lines === 0 ? start.column + index : index - lastBreak,
        offset: start.offset! + index,
    }
}

type Locator = { position: (from: number, to: number) => Position | undefined; escaped: (index: number) => boolean }

/** Finds the places in the source of the characters of a text node, when the source is there to read. */
function locator(node: Text, source: string): Locator {
    const start = node.position?.start
    const end = node.position?.end
    if (!source || start?.offset === undefined || end?.offset === undefined) return { position: () => undefined, escaped: () => false }
    const raw = source.slice(start.offset, end.offset)
    const { value } = node
    const map = alignWithSource(value, raw)
    /** Where the character at `index` of the value ends in the source: after its escape or reference, if it has one. */
    const endOf = (index: number): number => {
        const at = map[index]!
        if (raw[at] === '\\' && raw[at + 1] === value[index]) return at + 2
        if (raw[at] === '&' && value[index] !== '&') {
            CHARACTER_REFERENCE.lastIndex = at
            const reference = CHARACTER_REFERENCE.exec(raw)
            if (reference) return at + reference[0].length
        }
        return Math.min(at + 1, raw.length)
    }
    return {
        position: (from, to) => ({ start: pointIn(raw, start, map[from]!), end: pointIn(raw, start, endOf(to - 1)) }),
        escaped: (index) => raw[map[index]!] === '\\' && value[index] !== '\\',
    }
}

function textNode(value: string, position: Position | undefined): Text {
    return position ? { type: 'text', value, position } : { type: 'text', value }
}

/** A text node's wiki links, with the text around them, or null when it has none. */
function splitText(node: Text, source: string): PhrasingContent[] | null {
    const { value } = node
    if (!value.includes('[[')) return null
    let located: Locator | null = null
    const out: PhrasingContent[] = []
    let last = 0
    for (const match of value.matchAll(WIKI_LINK)) {
        const from = match.index
        const to = from + match[0].length
        // An embed (`![[Note]]`), which Scrivon doesn't show, stays as written.
        if (value[from - 1] === '!') continue
        const parts = parseWikiLinkText(match[1]!)
        if (!parts) continue
        located ??= locator(node, source)
        // `\[[Note]]` or `[[Note\]]` was written to show the brackets.
        if ([from, from + 1, to - 2, to - 1].some(located.escaped)) continue

        if (from > last) out.push(textNode(value.slice(last, from), located.position(last, from)))
        const inner = from + 2
        const shownFrom = inner + parts.shown.start
        const shownTo = inner + parts.shown.end
        const shown = parts.label
            ? textNode(parts.label, located.position(shownFrom, shownTo))
            : textNode(wikiLinkText(parts), located.position(shownFrom, shownTo))
        const position = located.position(from, to)
        const link: WikiLink = {
            type: 'wikiLink',
            target: parts.target,
            heading: parts.heading,
            label: parts.label,
            children: [shown],
            data: {
                hName: 'a',
                hProperties: {
                    className: [WIKI_LINK_CLASS],
                    ...(parts.target ? { dataWikiTarget: parts.target } : { href: wikiHeadingHref(parts.heading!) }),
                    ...(parts.heading ? { dataWikiHeading: parts.heading } : {}),
                },
            },
            ...(position ? { position } : {}),
        }
        out.push(link)
        last = to
    }
    if (out.length === 0) return null
    if (last < value.length) out.push(textNode(value.slice(last), located!.position(last, value.length)))
    return out
}

const isText = (node: Nodes | undefined): node is Text => node?.type === 'text'

/**
 * `[[a]]` in a document that defines `[a]: url` is read as `[`, a reference link to `a`, and `]`. Puts those three
 * back into one text node, so the link reads the same with or without the definition.
 */
function joinReferences(parent: Parent): void {
    const children = parent.children
    for (let i = 1; i < children.length - 1; i += 1) {
        const reference = children[i]!
        if (reference.type !== 'linkReference' || reference.referenceType !== 'shortcut') continue
        const before = children[i - 1]
        const after = children[i + 1]
        if (!isText(before) || !isText(after) || !before.value.endsWith('[') || !after.value.startsWith(']')) continue
        if (!reference.children.every(isText)) continue
        const touching =
            before.position?.end.offset === reference.position?.start.offset && reference.position?.end.offset === after.position?.start.offset
        if (!touching) continue
        const inner = reference.children.map((child) => (child as Text).value).join('')
        const joined: Text = {
            type: 'text',
            value: `${before.value}[${inner}]${after.value}`,
            ...(before.position && after.position ? { position: { start: before.position.start, end: after.position.end } } : {}),
        }
        children.splice(i - 1, 3, joined)
        i -= 1
    }
}

/** Nodes whose text is never a wiki link: a link's own text, and wiki links already made. */
const LINK_TYPES = new Set(['link', 'linkReference', 'wikiLink'])

function transform(parent: Parent, source: string): void {
    joinReferences(parent)
    for (let i = 0; i < parent.children.length; i += 1) {
        const child = parent.children[i]!
        if (child.type === 'text') {
            const split = splitText(child, source)
            if (!split) continue
            parent.children.splice(i, 1, ...split)
            i += split.length - 1
        } else if ('children' in child && !LINK_TYPES.has(child.type)) {
            transform(child, source)
        }
    }
}

/**
 * Turns each `[[…]]` in the tree's text into a wikiLink node, which keeps its place in `source` (the text the tree was
 * read from), as does its shown text. Code, maths and raw HTML aren't text, so they are never touched, and nor is the
 * text of a link. Without `source` the links are still made, but nothing new has a place.
 */
export function applyWikiLinks(tree: Root, source: string): void {
    transform(tree, source)
}

/** The remark plugin: {@link applyWikiLinks} on the document the tree was read from. Only where the tree is run. */
export function remarkWikiLinks() {
    return (tree: Root, file: VFile) => applyWikiLinks(tree, String(file))
}

/** Whether a hast element's class list marks it as a wiki link. */
export function isWikiLinkClass(className: unknown): boolean {
    if (Array.isArray(className)) return className.includes(WIKI_LINK_CLASS)
    return typeof className === 'string' && className.split(/\s+/).includes(WIKI_LINK_CLASS)
}
