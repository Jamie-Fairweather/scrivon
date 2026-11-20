import type { Definition, FootnoteReference, Html, Image, ImageReference, Link, LinkReference, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Position } from 'unist'
import { visit } from 'unist-util-visit'
import { parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'
import { collectPdfExportOutline } from '@/lib/markdown/export-outline'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'

/**
 * Where the links in a Markdown document point, and the ids its `#fragments` can reach. Pure (no DOM, React, Monaco
 * or Tauri), so the links worker, the main-thread fallback and tests all load it. The link check reads it, and so
 * does anything that rewrites addresses.
 */

/** Characters `start` (inclusive) to `end` (exclusive) of the whole document, front matter included. */
export type TextSpan = { start: number; end: number }

/**
 * - `link`: `[text](address)`.
 * - `image`: `![alt](address)`.
 * - `definition`: `[label]: address`, which reference links and images use.
 * - `reference`: `[text][label]`, `[label][]` or `[label]` (or the same as an image), whose address is its definition's.
 */
export type DocumentLinkKind = 'link' | 'image' | 'definition' | 'reference'

export type DocumentLink = {
    kind: DocumentLinkKind
    /** The address as the parser read it (backslash escapes and `&amp;` undone, percent-encoding kept). */
    url: string
    /** Where the whole node is, counted from the top of the file as the editor counts it (front matter included). */
    position: Position
    /**
     * Exactly where the address is written, inside any `<…>` and without the title. Null for a reference (its address
     * is written in its definition) and for an address whose place couldn't be told for sure, which is then left alone.
     */
    address: TextSpan | null
    /** The address is written in `<…>`. */
    angleBrackets?: true
    /** A definition's or reference's label, normalised as the parser compares them. */
    identifier?: string
    /** A definition only images use (`![alt][label]`), or a reference to one from an image. */
    image?: true
}

export type DocumentLinks = {
    links: DocumentLink[]
    /**
     * Every id a `#fragment` in the document can reach, as the document writes it (without the preview's
     * `user-content-` prefix): its headings (as the preview gives them), its footnotes (`fn-1`, `fnref-1`) and the
     * `id`s, and `name`s on `<a>`, in its raw HTML. Headings come first, in order.
     */
    anchors: string[]
}

const parser = unified().use(remarkParse).use(markdownRemarkPlugins).freeze()

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
const ESCAPE = /\\([!-/:-@[-`{-~])/g
const CHARACTER_REFERENCE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED_REFERENCES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** An address as written, read the way the parser reads it: escapes and the common character references undone. */
function readAddress(raw: string): string {
    return raw.replace(ESCAPE, '$1').replace(CHARACTER_REFERENCE, (whole, decimal?: string, hex?: string, name?: string) => {
        if (name) return NAMED_REFERENCES[name]!
        const code = decimal ? Number(decimal) : parseInt(hex!, 16)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
}

/** The place after a run of spaces and tabs, with at most one line break, from `index`. */
function skipSpace(text: string, index: number): number {
    let i = index
    let breaks = 0
    while (i < text.length) {
        const c = text[i]!
        if (c === ' ' || c === '\t') i += 1
        else if ((c === '\n' || c === '\r') && breaks === 0) {
            breaks += 1
            i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
        } else break
    }
    return i
}

/**
 * The destination that starts at `index` (just after `(`, or after a definition's `:`), as CommonMark reads it: `<…>`,
 * or a run with no spaces in which `(` and `)` pair up and a backslash escapes punctuation.
 */
function scanDestination(text: string, index: number): { span: TextSpan; angleBrackets: boolean } | null {
    const start = skipSpace(text, index)
    if (text[start] === '<') {
        for (let i = start + 1; i < text.length; i += 1) {
            const c = text[i]!
            if (c === '\\' && i + 1 < text.length && ASCII_PUNCTUATION.test(text[i + 1]!)) i += 1
            else if (c === '>') return { span: { start: start + 1, end: i }, angleBrackets: true }
            else if (c === '<' || c === '\n' || c === '\r') return null
        }
        return null
    }
    let depth = 0
    let i = start
    for (; i < text.length; i += 1) {
        const c = text[i]!
        if (c === '\\' && i + 1 < text.length && ASCII_PUNCTUATION.test(text[i + 1]!)) {
            i += 1
            continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
            if (depth === 0) break
            depth -= 1
        } else if (c <= ' ') break
    }
    return { span: { start, end: i }, angleBrackets: false }
}

/** The length of the run of backticks at `index`. */
function backtickRun(text: string, index: number): number {
    let i = index
    while (text[i] === '`') i += 1
    return i - index
}

/**
 * The `]` that closes the label opened just before `index`, with brackets inside it paired up, backslash escapes and
 * code spans skipped. -1 when there is none.
 */
function closingBracket(text: string, index: number): number {
    let depth = 0
    for (let i = index; i < text.length; i += 1) {
        const c = text[i]!
        if (c === '\\') {
            i += 1
        } else if (c === '`') {
            const run = backtickRun(text, i)
            const close = text.indexOf('`'.repeat(run), i + run)
            // A run with no matching run after it is just backticks.
            if (close >= 0 && backtickRun(text, close) === run) i = close + run - 1
            else i += run - 1
        } else if (c === '[') {
            depth += 1
        } else if (c === ']') {
            if (depth === 0) return i
            depth -= 1
        }
    }
    return -1
}

/** Where `node`'s address is, in `text` (the node's own source), checked against what the parser read. */
function inlineAddress(node: Link | Image, text: string, nodeStart: number): { span: TextSpan; angleBrackets: boolean } | null {
    const image = node.type === 'image'
    if (!text.startsWith(image ? '![' : '[')) return null // an autolink, `<https://…>` or `www.…`
    const labelStart = image ? 2 : 1
    // A link's text is parsed into children, which cover all of it, so the `]` follows the last one; code and maths in
    // the text then can't be taken for the end.
    const last = image ? undefined : (node as Link).children.at(-1)?.position?.end.offset
    const from = last !== undefined ? Math.max(labelStart, last - nodeStart) : labelStart
    const close = closingBracket(text, from)
    if (close < 0 || text[close + 1] !== '(') return null
    return scanDestination(text, close + 2)
}

function definitionAddress(text: string): { span: TextSpan; angleBrackets: boolean } | null {
    if (!text.startsWith('[')) return null
    const close = closingBracket(text, 1)
    if (close < 0 || text[close + 1] !== ':') return null
    return scanDestination(text, close + 2)
}

/** Lower case, as mdast-util-to-hast spells a footnote's id, with what can't go in an address percent-encoded. */
function footnoteId(identifier: string): string {
    return identifier
        .toUpperCase()
        .toLowerCase()
        .replace(/[^\w!#$&'()*+,\-./:;=?@~%]/gu, (c) => encodeURIComponent(c))
}

const HTML_TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g
const HTML_ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** The `id`s in raw HTML, and `name`s on `<a>`, which a `#fragment` can reach as in a browser. */
function htmlAnchors(html: string, into: string[]): void {
    for (const [, tag, attributes] of html.matchAll(HTML_TAG)) {
        if (!attributes) continue
        for (const [, name, double, single, bare] of attributes.matchAll(HTML_ATTRIBUTE)) {
            const key = name!.toLowerCase()
            const value = double ?? single ?? bare
            if (!value) continue
            if (key === 'id' || (key === 'name' && tag!.toLowerCase() === 'a')) into.push(readAddress(value))
        }
    }
}

/** A position moved down by the front matter above the text it was read from. */
function shifted(position: Position, lines: number, chars: number): Position {
    return {
        start: { line: position.start.line + lines, column: position.start.column, offset: (position.start.offset ?? 0) + chars },
        end: { line: position.end.line + lines, column: position.end.column, offset: (position.end.offset ?? 0) + chars },
    }
}

/**
 * The links, images, reference links and definitions in a Markdown document, in order, and the ids its anchors can
 * reach. Read with the preview's parser and plugins after the front matter is taken off, so links in code and maths
 * are skipped and heading ids are the preview's; positions are counted from the top of the file, front matter
 * included, as the editor counts them.
 */
export function documentLinks(source: string): DocumentLinks {
    const { body } = parsePdfExportFrontMatter(source)
    const chars = source.length - body.length
    const lines = source.slice(0, chars).split('\n').length - 1
    // Run, not only parsed, so the plugins that change the tree after reading it (GitHub's alerts) have their say.
    const tree = parser.runSync(parser.parse(body)) as Root

    const definitions = new Map<string, string>()
    const imageReferences = new Set<string>()
    const linkReferences = new Set<string>()
    visit(tree, (node) => {
        // The first definition of a label is the one links use, as in CommonMark and the preview.
        if (node.type === 'definition') {
            const { identifier, url } = node as Definition
            if (!definitions.has(identifier)) definitions.set(identifier, url)
        } else if (node.type === 'imageReference') imageReferences.add((node as ImageReference).identifier)
        else if (node.type === 'linkReference') linkReferences.add((node as LinkReference).identifier)
    })

    const links: DocumentLink[] = []
    const anchors = collectPdfExportOutline(tree).map((heading) => heading.id)
    const footnoteRefs = new Map<string, number>()

    const located = (node: Link | Image | Definition, kind: DocumentLinkKind, found: { span: TextSpan; angleBrackets: boolean } | null) => {
        const nodeStart = node.position!.start.offset!
        const text = body.slice(nodeStart, node.position!.end.offset!)
        // Only an address that reads back as what the parser read is marked or changed: anything else is left alone.
        const sure = found && readAddress(text.slice(found.span.start, found.span.end)) === node.url ? found : null
        return {
            kind,
            url: node.url,
            position: shifted(node.position!, lines, chars),
            address: sure ? { start: sure.span.start + nodeStart + chars, end: sure.span.end + nodeStart + chars } : null,
            ...(sure?.angleBrackets ? { angleBrackets: true as const } : {}),
        } satisfies DocumentLink
    }

    visit(tree, (node) => {
        if (!node.position) return
        switch (node.type) {
            case 'link':
            case 'image': {
                const link = node as Link | Image
                const text = body.slice(link.position!.start.offset!, link.position!.end.offset!)
                if (!text.startsWith('[') && !text.startsWith('![')) return // autolinks are web or mail links
                links.push(located(link, link.type, inlineAddress(link, text, link.position!.start.offset!)))
                return
            }
            case 'definition': {
                const definition = node as Definition
                const text = body.slice(definition.position!.start.offset!, definition.position!.end.offset!)
                const onlyImages = imageReferences.has(definition.identifier) && !linkReferences.has(definition.identifier)
                links.push({
                    ...located(definition, 'definition', definitionAddress(text)),
                    identifier: definition.identifier,
                    ...(onlyImages ? { image: true as const } : {}),
                })
                return
            }
            case 'linkReference':
            case 'imageReference': {
                const reference = node as LinkReference | ImageReference
                links.push({
                    kind: 'reference',
                    url: definitions.get(reference.identifier) ?? '',
                    position: shifted(reference.position!, lines, chars),
                    address: null,
                    identifier: reference.identifier,
                    ...(reference.type === 'imageReference' ? { image: true as const } : {}),
                })
                return
            }
            case 'footnoteReference': {
                const id = footnoteId((node as FootnoteReference).identifier)
                const count = (footnoteRefs.get(id) ?? 0) + 1
                footnoteRefs.set(id, count)
                if (count === 1) anchors.push(`fn-${id}`, `fnref-${id}`)
                else anchors.push(`fnref-${id}-${count}`)
                return
            }
            case 'html':
                htmlAnchors((node as Html).value, anchors)
                return
        }
    })
    // The heading over the footnotes at the end of the preview.
    if (footnoteRefs.size > 0) anchors.push('footnote-label')
    return { links, anchors }
}

/** {@link documentLinks}, or nothing when the parser can't take the text (thousands of nested quotes). */
export function readDocumentLinks(source: string): DocumentLinks {
    try {
        return documentLinks(source)
    } catch {
        return { links: [], anchors: [] }
    }
}

/** Whether a `#` or `?` (escaped or not) is at `i` in an address as written; how many characters it takes, or 0. */
function delimiterAt(written: string, i: number, delimiters: string): number {
    const c = written[i]
    if (c !== undefined && delimiters.includes(c)) return 1
    if (c === '\\' && written[i + 1] !== undefined && delimiters.includes(written[i + 1]!)) return 2
    return 0
}

/**
 * Where the path ends in an address as written: before its `?query` or `#fragment`. An escaped `\#` or `\?` ends it
 * too, as the parser's url has the escape undone and the preview splits it there (resolveMarkdownLink); an escaped
 * backslash (`\\`) doesn't.
 */
export function addressPathLength(written: string): number {
    for (let i = 0; i < written.length; i += 1) {
        if (delimiterAt(written, i, '#?')) return i
        if (written[i] === '\\') i += 1
    }
    return written.length
}

/** Where the path ends and the fragment (after its `#`) starts in an address as written. */
export type AddressParts = { pathEnd: number; fragmentStart: number | null }

/**
 * The path and fragment of an address as written, split where the preview splits the parser's `url` (the first `#`,
 * and a `?` before it). Null when the written parts don't read back as the url's (a `&#35;` written for the `#`, say),
 * so nothing is changed in the wrong place.
 */
export function addressParts(written: string, url: string): AddressParts | null {
    const pathEnd = addressPathLength(written)
    const hash = url.indexOf('#')
    const beforeHash = hash >= 0 ? url.slice(0, hash) : url
    const query = beforeHash.indexOf('?')
    if (readAddress(written.slice(0, pathEnd)) !== (query >= 0 ? beforeHash.slice(0, query) : beforeHash)) return null

    let fragmentStart: number | null = null
    for (let i = pathEnd; i < written.length; i += 1) {
        const width = delimiterAt(written, i, '#')
        if (width) {
            fragmentStart = i + width
            break
        }
        if (written[i] === '\\') i += 1
    }
    if (hash < 0) return fragmentStart === null ? { pathEnd, fragmentStart } : null
    if (fragmentStart === null || readAddress(written.slice(fragmentStart)) !== url.slice(hash + 1)) return null
    return { pathEnd, fragmentStart }
}
