import { blankComments, blankFrontMatter, flowchartStatementRanges } from '@/lib/mermaid/prepare-source'
import type { DiagramTarget } from '@/lib/mermaid/diagram-targets'

/**
 * Where each part of a flowchart, state or sequence diagram is written in its text, so double-clicking a part on the
 * canvas (or picking it from `@` in the palette) can select it in the editor. The text is read as beautiful-mermaid
 * reads it (lib/mermaid/prepare-source.ts and the renderer's own parsers), but always against the raw text the
 * editor holds: never the prepared text, whose split `;` statements move parts to other lines.
 */

/** A place in the diagram's text: its line and column from 1, and how many characters to select. */
export type SourceLocation = { line: number; column: number; length: number }

/** The types whose parts can be picked. `other` covers every other type, and text with no header yet. */
export type DiagramPartsKind = 'flowchart' | 'state' | 'sequence' | 'other'

/** What a target needs to be found by: see DiagramTarget. */
export type TargetKey = Pick<DiagramTarget, 'kind' | 'id' | 'from' | 'to' | 'occurrence'>

/** A stretch of one line: its index from 0, and where it starts and ends. */
type Span = { line: number; start: number; end: number }

type SourceMap = {
    kind: DiagramPartsKind
    /** A node's or state's first place that gives it a shape or a label. */
    definitions: Map<string, Span>
    /** A node's or state's first mention, or a participant's first message. */
    mentions: Map<string, Span>
    /** A subgraph's or composite state's id on the line that opens it. */
    groups: Map<string, Span>
    /** A participant's `participant` or `actor` line. */
    declarations: Map<string, Span>
    /** Each link, transition or message between two parts, in the order written. */
    connections: Map<string, Span[]>
}

function pairKey(from: string, to: string): string {
    return `${from}\u0000${to}`
}

const ACC_LINE = /^[ \t]*(?:accTitle|accDescr)[ \t]*:/
const ACC_BLOCK = /^[ \t]*accDescr[ \t]*\{/

/**
 * `accTitle` and `accDescr` lines blanked, as accessibility.ts does for the renderer, but keeping every column:
 * text after an `accDescr { … }` block's closing brace stays where it is.
 */
function blankAccessibility(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (ACC_LINE.test(line)) {
            lines[i] = ''
            continue
        }
        if (!ACC_BLOCK.test(line)) continue
        const open = line.indexOf('{')
        let end = i
        let close = line.indexOf('}', open)
        while (close === -1 && end + 1 < lines.length) close = lines[++end]!.indexOf('}')
        // Not closed yet: the renderer reads it as diagram text, and so does this.
        if (close === -1) continue
        lines.fill('', i, end)
        lines[end] = ' '.repeat(close + 1) + lines[end]!.slice(close + 1)
        i = end
    }
}

/** The text's lines with what the renderer never draws blanked: front matter, `%%` comments, accessibility lines. */
function codeLines(source: string): string[] {
    const lines = source.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    blankAccessibility(lines)
    blankFrontMatter(lines)
    blankComments(lines)
    return lines
}

function kindOfHeader(header: string): DiagramPartsKind {
    if (/^(?:graph|flowchart)\b/i.test(header)) return 'flowchart'
    if (/^stateDiagram(?:-v2)?\b/i.test(header)) return 'state'
    if (/^sequenceDiagram\b/i.test(header)) return 'sequence'
    return 'other'
}

/** A line's statement, trimmed, and where it starts on the line. */
type Statement = { text: string; offset: number; line: number }

function statement(line: number, raw: string, offset: number): Statement | null {
    const text = raw.trim()
    if (!text) return null
    return { text, offset: offset + (raw.length - raw.trimStart().length), line }
}

function skipSpaces(text: string, at: number): number {
    while (at < text.length && /\s/.test(text[at]!)) at++
    return at
}

// ---------------------------------------------------------------------------------------------------------------
// Flowcharts, as beautiful-mermaid's parser reads them (its parser.ts)

const ARROW = /^(<)?(-->|-.->|==>|---|-\.-|===)(?:\|([^|]*)\|)?/
const TEXT_ARROW = /^(<)?(--|-\.|==)\s+(.+?)\s+(-->|---|\.\->|-\.\-|==>|===)/
const NODE_SHAPES: readonly RegExp[] = [
    /^([\w-]+)\(\(\((.+?)\)\)\)/,
    /^([\w-]+)\(\[(.+?)\]\)/,
    /^([\w-]+)\(\((.+?)\)\)/,
    /^([\w-]+)\[\[(.+?)\]\]/,
    /^([\w-]+)\[\((.+?)\)\]/,
    /^([\w-]+)\[\/(.+?)\\\]/,
    /^([\w-]+)\[\\(.+?)\/\]/,
    /^([\w-]+)>(.+?)\]/,
    /^([\w-]+)\{\{(.+?)\}\}/,
    /^([\w-]+)\[(.+?)\]/,
    /^([\w-]+)\((.+?)\)/,
    /^([\w-]+)\{(.+?)\}/,
]
const BARE_NODE = /^([\w-]+)/
const CLASS_SHORTHAND = /^:::([\w][\w-]*)/
/** Lines that style or script the diagram rather than draw a part. */
const FLOWCHART_SKIP = [
    /^classDef\s+\w+\s+.+$/,
    /^class\s+[\w,-]+\s+\w+$/,
    /^style\s+[\w,-]+\s+.+$/,
    /^linkStyle\s+(?:default|[\d,\s]+)\s+.+$/,
    /^click\s/,
]
const DIRECTION = /^direction\s+(?:TD|TB|LR|BT|RL)\s*$/i

type ParsedNode = { id: string; start: number; end: number; defined: boolean }
type ParsedGroup = { nodes: ParsedNode[]; start: number; end: number }

function consumeNode(text: string, at: number): ParsedNode | null {
    const rest = text.slice(at)
    let node: ParsedNode | null = null
    for (const shape of NODE_SHAPES) {
        const match = shape.exec(rest)
        if (match) {
            node = { id: match[1]!, start: at, end: at + match[0].length, defined: true }
            break
        }
    }
    if (!node) {
        const bare = BARE_NODE.exec(rest)
        if (!bare) return null
        node = { id: bare[1]!, start: at, end: at + bare[0].length, defined: false }
    }
    const shorthand = CLASS_SHORTHAND.exec(text.slice(node.end))
    if (shorthand) node.end += shorthand[0].length
    return node
}

/** One or more nodes joined by `&`. */
function consumeGroup(text: string, at: number): ParsedGroup | null {
    const first = consumeNode(text, at)
    if (!first) return null
    const nodes = [first]
    let next = skipSpaces(text, first.end)
    while (text[next] === '&') {
        const node = consumeNode(text, skipSpaces(text, next + 1))
        if (!node) break
        nodes.push(node)
        next = skipSpaces(text, node.end)
    }
    return { nodes, start: first.start, end: nodes[nodes.length - 1]!.end }
}

function emptyMap(kind: DiagramPartsKind): SourceMap {
    return { kind, definitions: new Map(), mentions: new Map(), groups: new Map(), declarations: new Map(), connections: new Map() }
}

function setFirst(map: Map<string, Span>, key: string, span: Span): void {
    if (!map.has(key)) map.set(key, span)
}

function addConnection(map: SourceMap, from: string, to: string, span: Span): void {
    const key = pairKey(from, to)
    const list = map.connections.get(key)
    if (list) list.push(span)
    else map.connections.set(key, [span])
}

function readFlowchartStatement(map: SourceMap, { text, offset, line }: Statement): void {
    const span = (start: number, end: number): Span => ({ line, start: offset + start, end: offset + end })
    const noteNodes = (group: ParsedGroup) => {
        for (const node of group.nodes) {
            const idSpan = span(node.start, node.start + node.id.length)
            setFirst(map.mentions, node.id, idSpan)
            if (node.defined) setFirst(map.definitions, node.id, idSpan)
        }
    }

    let previous = consumeGroup(text, 0)
    if (!previous) return
    noteNodes(previous)
    let at = skipSpaces(text, previous.end)
    while (at < text.length) {
        const rest = text.slice(at)
        const arrow = ARROW.exec(rest) ?? TEXT_ARROW.exec(rest)
        if (!arrow) break
        const next = consumeGroup(text, skipSpaces(text, at + arrow[0].length))
        if (!next) break
        noteNodes(next)
        // `A --> B --> C` gives B → C the text `B --> C`; `A & B --> C` gives each link the whole statement.
        for (const from of previous.nodes) for (const to of next.nodes) addConnection(map, from.id, to.id, span(previous.start, next.end))
        previous = next
        at = skipSpaces(text, next.end)
    }
}

function readFlowchart(lines: string[], header: number): SourceMap {
    const map = emptyMap('flowchart')
    let depth = 0
    for (let i = header; i < lines.length; i++) {
        const line = lines[i]!
        const ranges = flowchartStatementRanges(line)
        // The header line may carry statements after a `;`: `graph TD; A --> B`.
        for (const [start, end] of i === header ? ranges.slice(1) : ranges) {
            const found = statement(i, line.slice(start, end), start)
            if (!found) continue
            const { text } = found
            if (FLOWCHART_SKIP.some((skip) => skip.test(text))) continue
            if (depth > 0 && DIRECTION.test(text)) continue
            const subgraph = /^subgraph\s+(.+)$/.exec(text)
            if (subgraph) {
                depth++
                const rest = subgraph[1]!.trim()
                const restStart = found.offset + text.indexOf(rest, 'subgraph'.length)
                const bracket = /^([\w-]+)\s*\[(.+)\]$/.exec(rest)
                // `subgraph id [Label]` goes by its id; `subgraph Some title` by its title, as the renderer makes its id.
                const id = bracket ? bracket[1]! : rest.replace(/\s+/g, '_').replace(/[^\w]/g, '')
                setFirst(map.groups, id, { line: i, start: restStart, end: restStart + (bracket ? id.length : rest.length) })
                continue
            }
            if (text === 'end') {
                depth = Math.max(0, depth - 1)
                continue
            }
            readFlowchartStatement(map, found)
        }
    }
    return map
}

// ---------------------------------------------------------------------------------------------------------------
// State diagrams

const STATE_COMPOSITE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}]+)\s*\{$/u
const STATE_ALIAS = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}]+)\s*$/u
const STATE_TRANSITION = /^(\[\*\]|[\w\p{L}-]+)\s*(-->)\s*(\[\*\]|[\w\p{L}-]+)(?:\s*:\s*(.+))?$/u
const STATE_DESCRIPTION = /^([\w\p{L}-]+)\s*:\s*(.+)$/u
const STATE_SKIP = [/^direction\s+(?:TD|TB|LR|BT|RL)\s*$/i, /^linkStyle\s+(?:default|[\d,\s]+)\s+.+$/, /^classDef\s/, /^class\s/, /^style\s/]

function readState(lines: string[], header: number): SourceMap {
    const map = emptyMap('state')
    // Each `[*]` is a point of its own, numbered across the whole diagram as the renderer numbers them.
    let starts = 0
    let ends = 0
    for (let i = header + 1; i < lines.length; i++) {
        const found = statement(i, lines[i]!, 0)
        if (!found) continue
        const { text, offset } = found
        const span = (start: number, end: number): Span => ({ line: i, start: offset + start, end: offset + end })
        if (STATE_SKIP.some((skip) => skip.test(text))) continue

        const composite = STATE_COMPOSITE.exec(text)
        if (composite) {
            const id = composite[2]!
            // The id is the last word before the `{`.
            const idEnd = text.slice(0, -1).trimEnd().length
            setFirst(map.groups, id, span(idEnd - id.length, idEnd))
            continue
        }
        const alias = STATE_ALIAS.exec(text)
        if (alias) {
            const id = alias[2]!
            setFirst(map.definitions, id, span(text.length - id.length, text.length))
            setFirst(map.mentions, id, span(text.length - id.length, text.length))
            continue
        }
        const transition = STATE_TRANSITION.exec(text)
        if (transition) {
            const sourceToken = transition[1]!
            const targetToken = transition[3]!
            const targetStart = skipSpaces(text, text.indexOf('-->', sourceToken.length) + 3)
            const from = sourceToken === '[*]' ? `_start${++starts > 1 ? starts : ''}` : sourceToken
            const to = targetToken === '[*]' ? `_end${++ends > 1 ? ends : ''}` : targetToken
            if (sourceToken !== '[*]') setFirst(map.mentions, from, span(0, sourceToken.length))
            if (targetToken !== '[*]') setFirst(map.mentions, to, span(targetStart, targetStart + targetToken.length))
            addConnection(map, from, to, span(0, text.length))
            continue
        }
        const description = STATE_DESCRIPTION.exec(text)
        if (description) {
            const id = description[1]!
            setFirst(map.definitions, id, span(0, id.length))
            setFirst(map.mentions, id, span(0, id.length))
        }
    }
    return map
}

// ---------------------------------------------------------------------------------------------------------------
// Sequence diagrams, as beautiful-mermaid's sequence/parser.ts reads them

const SEQUENCE_ACTOR = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/
const SEQUENCE_NOTE = /^Note\s+(?:left of|right of|over)\s+([^:]+):\s*(.+)$/i
const SEQUENCE_MESSAGE = /^(\S+?)(\s*)(--?>?>|--?[)x]|--?>>|--?>)(\s*)([+-]?)(\S+?)\s*:\s*(.+)$/
const SEQUENCE_SIMPLE_MESSAGE = /^(\S+?)(\s*)(->>|-->>|-\)|--\)|-x|--x|->|-->)(\s*)([+-]?)(\S+?)\s*:\s*(.+)$/

function readSequence(lines: string[], header: number): SourceMap {
    const map = emptyMap('sequence')
    /** Where an actor first named only in a note is: the last place to look. */
    const notes = new Map<string, Span>()
    for (let i = header + 1; i < lines.length; i++) {
        const found = statement(i, lines[i]!, 0)
        if (!found) continue
        const { text, offset } = found
        const span = (start: number, end: number): Span => ({ line: i, start: offset + start, end: offset + end })

        const actor = SEQUENCE_ACTOR.exec(text)
        if (actor) {
            setFirst(map.declarations, actor[2]!, span(0, text.length))
            continue
        }
        const note = SEQUENCE_NOTE.exec(text)
        if (note) {
            let at = text.indexOf(note[1]!)
            for (const raw of note[1]!.split(',')) {
                const id = raw.trim()
                const start = at + raw.indexOf(id)
                if (id) setFirst(notes, id, span(start, start + id.length))
                at += raw.length + 1
            }
            continue
        }
        const message = SEQUENCE_MESSAGE.exec(text) ?? SEQUENCE_SIMPLE_MESSAGE.exec(text)
        if (message) {
            const [, from, gapBefore, arrow, gapAfter, mark, to] = message as unknown as string[]
            const toStart = from!.length + gapBefore!.length + arrow!.length + gapAfter!.length + mark!.length
            setFirst(map.mentions, from!, span(0, from!.length))
            setFirst(map.mentions, to!, span(toStart, toStart + to!.length))
            addConnection(map, from!, to!, span(0, text.length))
        }
    }
    for (const [id, place] of notes) setFirst(map.mentions, id, place)
    return map
}

// ---------------------------------------------------------------------------------------------------------------

function readSourceMap(source: string): SourceMap {
    const lines = codeLines(source)
    const header = lines.findIndex((line) => line.trim() !== '')
    if (header === -1) return emptyMap('other')
    const kind = kindOfHeader(lines[header]!.trim())
    if (kind === 'flowchart') return readFlowchart(lines, header)
    if (kind === 'state') return readState(lines, header)
    if (kind === 'sequence') return readSequence(lines, header)
    return emptyMap(kind)
}

/** The last text read, as the canvas and the palette ask for the same text many times in a row. */
let last: { source: string; map: SourceMap } | null = null

function sourceMap(source: string): SourceMap {
    if (last?.source !== source) last = { source, map: readSourceMap(source) }
    return last.map
}

/** Whether the diagram's parts can be picked: flowcharts, state and sequence diagrams. */
export function diagramPartsKind(source: string): DiagramPartsKind {
    return sourceMap(source).kind
}

function toLocation(span: Span | undefined): SourceLocation | null {
    if (!span) return null
    return { line: span.line + 1, column: span.start + 1, length: span.end - span.start }
}

/**
 * Where a part of the picture is written in `source`, the diagram's text as the editor holds it. A node or state: its
 * id where it is first given a shape or label, otherwise its first mention. A subgraph or composite state: its id on
 * the line that opens it. A link, transition or message: its text, the nth between the same two parts going to the
 * nth written. A participant: its `participant` or `actor` line, otherwise its first message. Null when the text has
 * no such part (the picture is older than the text, say).
 */
export function locateDiagramTarget(source: string, target: TargetKey): SourceLocation | null {
    const map = sourceMap(source)
    if (map.kind === 'other') return null
    switch (target.kind) {
        case 'node':
            return map.kind === 'sequence' ? null : toLocation(map.definitions.get(target.id) ?? map.mentions.get(target.id))
        case 'group':
            return toLocation(map.groups.get(target.id))
        case 'actor':
            return map.kind === 'sequence' ? toLocation(map.declarations.get(target.id) ?? map.mentions.get(target.id)) : null
        case 'edge':
            return map.kind === 'sequence' ? null : toLocation(map.connections.get(pairKey(target.from, target.to))?.[target.occurrence])
        case 'message':
            return map.kind === 'sequence' ? toLocation(map.connections.get(pairKey(target.from, target.to))?.[target.occurrence]) : null
    }
}

/** The opening of a fenced block: up to three spaces, then three or more backticks or tildes. */
const FENCE_MARK = /(`{3,}|~{3,})/
/** The opening tag of a block's code element, in a diagram written as raw HTML (`<pre><code class="language-mermaid">`). */
const CODE_TAG = /<code\b[^>]*>/i
/** How many lines, from a raw HTML block's `<pre>` line, its `<code>` tag is looked for on. */
const CODE_TAG_LOOKAHEAD = 3

type BlockTextStart = {
    /** The line (from 1) the block's first line is on. */
    line: number
    /** The column (from 0) the block's first line starts at. */
    firstColumn: number
    /** The column (from 0) its later lines start at. */
    indent: number
}

/**
 * Where a diagram block's text starts in the Markdown file. A fenced block's text starts on the line after the
 * fence, at the fence's column (past any list indent or `> `). A block written as raw HTML starts right after its
 * `<code ...>` tag, on the `<pre>` line or just below it.
 */
function blockTextStart(lines: string[], fenceLine: number): BlockTextStart | null {
    const fence = lines[fenceLine - 1]
    if (fence === undefined) return null
    const mark = fence.search(FENCE_MARK)
    if (mark !== -1) return { line: fenceLine + 1, firstColumn: mark, indent: mark }
    const indent = Math.max(0, fence.search(/<(?:pre|code)\b/i))
    for (let line = fenceLine; line < fenceLine + CODE_TAG_LOOKAHEAD && line <= lines.length; line++) {
        const tag = CODE_TAG.exec(lines[line - 1]!)
        if (tag) return { line, firstColumn: tag.index + tag[0].length, indent }
    }
    return { line: fenceLine + 1, firstColumn: 0, indent: 0 }
}

/**
 * A place in a Markdown diagram block's text, moved to the Markdown file. `fenceLine` is the line (from 1) the block
 * opens on: its fence, or for a block written as raw HTML its `<pre>` line. The block's text has any list indent or
 * `> ` taken off (as the preview shows it), so the part is looked for on the Markdown line from where the block's
 * text starts: first at the column it should be at, then anywhere after. Not found (the file changed under the
 * preview), the whole line is selected from column 1.
 */
export function locateInMarkdown(markdown: string, fenceLine: number, blockSource: string, location: SourceLocation): SourceLocation | null {
    const lines = markdown.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    const start = blockTextStart(lines, fenceLine)
    if (!start) return null
    const lineNumber = start.line + location.line - 1
    const text = lines[lineNumber - 1]
    if (text === undefined) return null
    const blockLine = blockSource.split('\n')[location.line - 1]?.replace(/\r$/, '') ?? ''
    const part = blockLine.slice(location.column - 1, location.column - 1 + location.length)
    const contentStart = location.line === 1 ? start.firstColumn : start.indent
    const expected = contentStart + location.column - 1
    if (part && text.startsWith(part, expected)) return { line: lineNumber, column: expected + 1, length: part.length }
    const found = part ? text.indexOf(part, contentStart) : -1
    if (found !== -1) return { line: lineNumber, column: found + 1, length: part.length }
    return { line: lineNumber, column: 1, length: text.length }
}
