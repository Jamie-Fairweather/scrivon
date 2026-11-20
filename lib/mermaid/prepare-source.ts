import { withoutAccessibilityLines } from '@/lib/mermaid/accessibility'

/**
 * Tidies Mermaid text before beautiful-mermaid reads it, so common input that Mermaid itself accepts
 * draws here too. Lines are blanked rather than removed, except where one line holds several statements.
 * Also says which engine draws a diagram (chooseDiagramEngine): beautiful-mermaid for the six types it
 * knows, the official `mermaid` package for most others (render-official.ts), and neither for ZenUML.
 */

/** The diagram types Scrivon draws, with the header that starts each one. The first six are beautiful-mermaid's. */
export const SUPPORTED_DIAGRAMS = [
    { name: 'Flowcharts', header: 'flowchart TD or graph LR' },
    { name: 'Sequence diagrams', header: 'sequenceDiagram' },
    { name: 'Class diagrams', header: 'classDiagram' },
    { name: 'State diagrams', header: 'stateDiagram-v2' },
    { name: 'Entity relationship diagrams', header: 'erDiagram' },
    { name: 'XY charts', header: 'xychart-beta' },
    { name: 'Pie charts', header: 'pie' },
    { name: 'Gantt charts', header: 'gantt' },
    { name: 'Mind maps', header: 'mindmap' },
    { name: 'Timelines', header: 'timeline' },
    { name: 'User journeys', header: 'journey' },
    { name: 'Git graphs', header: 'gitGraph' },
    { name: 'Quadrant charts', header: 'quadrantChart' },
    { name: 'Requirement diagrams', header: 'requirementDiagram' },
    { name: 'C4 diagrams', header: 'C4Context' },
    { name: 'Sankey diagrams', header: 'sankey-beta' },
    { name: 'Block diagrams', header: 'block-beta' },
    { name: 'Packet diagrams', header: 'packet-beta' },
    { name: 'Kanban boards', header: 'kanban' },
    { name: 'Architecture diagrams', header: 'architecture-beta' },
    { name: 'Radar charts', header: 'radar-beta' },
    { name: 'Treemaps', header: 'treemap-beta' },
] as const

/**
 * The types beautiful-mermaid can't draw that the official `mermaid` package does, by their header in lower case
 * without `-beta`. Each name is a plural ending in s. Mermaid reads the header itself, so it still has to be
 * spelt as Mermaid documents it (`gitGraph`, `radar-beta`); otherwise Mermaid's own error says so.
 */
export const OFFICIAL_MERMAID_DIAGRAMS: ReadonlyMap<string, string> = new Map(
    Object.entries({
        pie: 'Pie charts',
        gantt: 'Gantt charts',
        mindmap: 'Mind maps',
        journey: 'User journeys',
        gitgraph: 'Git graphs',
        timeline: 'Timelines',
        quadrantchart: 'Quadrant charts',
        requirement: 'Requirement diagrams',
        requirementdiagram: 'Requirement diagrams',
        c4context: 'C4 diagrams',
        c4container: 'C4 diagrams',
        c4component: 'C4 diagrams',
        c4dynamic: 'C4 diagrams',
        c4deployment: 'C4 diagrams',
        sankey: 'Sankey diagrams',
        block: 'Block diagrams',
        packet: 'Packet diagrams',
        kanban: 'Kanban boards',
        architecture: 'Architecture diagrams',
        radar: 'Radar charts',
        treemap: 'Treemaps',
    })
)

/** Mermaid types Scrivon can't draw at all, named as in OFFICIAL_MERMAID_DIAGRAMS. ZenUML needs a separate plugin. */
export const UNSUPPORTED_DIAGRAMS: ReadonlyMap<string, string> = new Map(Object.entries({ zenuml: 'ZenUML diagrams' }))

/** Names that keep their capital in a sentence: an initialism (XY, C4) or a name (Gantt). */
const KEEPS_CAPITAL = /^(?:[A-Z]{2}|C4\b|Gantt\b)/

/** How many types the canvas hint names before it says how many more there are. */
const SENTENCE_NAMES = 10

/** The types for a sentence: `flowcharts, sequence diagrams, … timelines and 12 other types`. */
export function supportedDiagramsSentence(): string {
    const names = SUPPORTED_DIAGRAMS.map(({ name }) => (KEEPS_CAPITAL.test(name) ? name : name[0]!.toLowerCase() + name.slice(1)))
    const more = names.length - SENTENCE_NAMES
    if (more <= 0) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    return `${names.slice(0, SENTENCE_NAMES).join(', ')} and ${more} other ${more === 1 ? 'type' : 'types'}`
}

/** The preview card's help for a type it can't draw: `ZenUML diagrams aren't supported yet. Scrivon can draw:` and the list. */
export function unsupportedDiagramMessage(name: string): string {
    const supported = SUPPORTED_DIAGRAMS.map((diagram) => `• ${diagram.name} (${diagram.header})`).join('\n')
    return `${name} aren't supported yet. Scrivon can draw:\n${supported}`
}

const FENCE = /^[ \t]*---[ \t]*\r?$/
const FLOWCHART_HEADER = /^[ \t]*(?:graph|flowchart)\b[ \t]*([^\s;]*)/i
const HEADER_WORD = /^[ \t]*([A-Za-z0-9]+)(?:-beta)?\b/

/** The first and last line of the front matter (`---` … `---` at the top), or null when there is none. */
function frontMatterLines(lines: string[]): [start: number, end: number] | null {
    const start = lines.findIndex((line) => line.trim() !== '')
    if (start === -1 || !FENCE.test(lines[start]!)) return null
    const end = lines.findIndex((line, i) => i > start && FENCE.test(line))
    return end === -1 ? null : [start, end]
}

/** Front matter holds settings and a title; the renderer would read it as the header. */
export function blankFrontMatter(lines: string[]): void {
    const range = frontMatterLines(lines)
    if (range) lines.fill('', range[0], range[1] + 1)
}

/** The `title:` in the diagram's front matter, which Mermaid shows above the diagram. */
export function readFrontMatterTitle(source: string): string | null {
    const lines = source.split('\n')
    const range = frontMatterLines(lines)
    const line = range ? lines.slice(range[0] + 1, range[1]).find((text) => text.startsWith('title:')) : undefined
    return line?.slice('title:'.length).trim() || null
}

/**
 * `%%` comments and `%%{init}%%` settings. The renderer skips them, but not when they come before the header. A
 * directive may run over several lines (`%%{` … `}%%`), as Mermaid reads it, so every line up to its close goes.
 */
export function blankComments(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trimStart()
        if (!line.startsWith('%%')) continue
        lines[i] = ''
        if (!line.startsWith('%%{') || line.includes('}%%', 3)) continue
        // A directive that never closes is left to the renderer's error, from the line after it.
        const close = lines.findIndex((next, j) => j > i && next.includes('}%%'))
        if (close === -1) continue
        lines.fill('', i + 1, close + 1)
        i = close
    }
}

/** Edge text written inline starts with `--`, `-.` or `==` and a space, as in `A -- yes --> B`. */
const EDGE_TEXT_START = /(?<![-=.])(?:--|-\.|==)\s/y
/** It ends at the next arrow with a space before it, as beautiful-mermaid reads it. */
const EDGE_TEXT_END = /\s(?:-->|---|\.->|-\.-|==>|===)/g

/** Where the inline edge text that starts at `i` ends, or -1 when no arrow closes it. */
function edgeTextEnd(line: string, i: number): number {
    let text = i + 2
    while (text < line.length && /\s/.test(line[text]!)) text++
    // The text is at least one character long.
    EDGE_TEXT_END.lastIndex = text + 1
    return EDGE_TEXT_END.exec(line) ? EDGE_TEXT_END.lastIndex : -1
}

/**
 * Where each statement of a flowchart line starts and ends (`A --> B; B --> C`), split at its semicolons but
 * leaving those inside quotes, node labels (`A[a;b]`, the flag `A>a;b]`), `|edge text|` and inline edge text
 * (`-- a;b -->`) alone. Every statement is listed, empty ones (after a trailing `;`) too, so a caller that maps a
 * diagram part back to its text (source-locations.ts) reads the line exactly as the renderer does.
 */
export function flowchartStatementRanges(line: string): Array<[start: number, end: number]> {
    const statements: Array<[start: number, end: number]> = []
    let depth = 0
    let quoted = false
    let piped = false
    // Once edge text finds no arrow to close it, none later on the line can either.
    let edgeTextCloses = true
    let start = 0
    for (let i = 0; i < line.length; i++) {
        const char = line[i]!
        if (piped) piped = char !== '|'
        else if (char === '"') quoted = !quoted
        else if (quoted) continue
        else if (char === '[' || char === '(' || char === '{') depth++
        else if (char === ']' || char === ')' || char === '}') depth = Math.max(0, depth - 1)
        else if (depth > 0) continue
        // A flag node opens with `>` straight after its id: `A>Flag]`. In an arrow it follows `-`, `=` or `.`.
        else if (char === '>' && /\w/.test(line[i - 1] ?? '')) depth++
        else if (char === '|') piped = true
        else if (char === ';') {
            statements.push([start, i])
            start = i + 1
        } else if (edgeTextCloses && (char === '-' || char === '=')) {
            EDGE_TEXT_START.lastIndex = i
            if (!EDGE_TEXT_START.test(line)) continue
            const end = edgeTextEnd(line, i)
            if (end === -1) edgeTextCloses = false
            else i = end - 1
        }
    }
    statements.push([start, line.length])
    return statements
}

/** A flowchart line split into its statements (see flowchartStatementRanges). Empty statements (a trailing `;`) are dropped. */
function flowchartStatements(line: string): string[] {
    const [first, ...rest] = flowchartStatementRanges(line).map(([start, end]) => line.slice(start, end))
    return [first!, ...rest.filter((statement) => statement.trim() !== '')]
}

/** A header line without its trailing `;` (`stateDiagram-v2;`). No regex, so a long run of spaces stays quick. */
function withoutTrailingSemicolon(line: string): string {
    const trimmed = line.trimEnd()
    return trimmed.endsWith(';') ? trimmed.slice(0, -1).trimEnd() : line
}

/** The lines as the renderer reads them (no front matter, comments or accessibility lines), and where the header is: -1 for none. */
function readableLines(source: string): { lines: string[]; headerIndex: number } {
    const lines = withoutAccessibilityLines(source).split('\n')
    blankFrontMatter(lines)
    blankComments(lines)
    return { lines, headerIndex: lines.findIndex((line) => line.trim() !== '') }
}

/** Which engine draws a diagram, and for the official package or none, the type's name in the plural (`Pie charts`). */
export type DiagramEngine = { engine: 'beautiful-mermaid' } | { engine: 'mermaid'; name: string } | { engine: 'unsupported'; name: string }

const BEAUTIFUL_MERMAID: DiagramEngine = { engine: 'beautiful-mermaid' }

function engineForHeader(header: string | undefined): DiagramEngine {
    const word = header === undefined ? undefined : HEADER_WORD.exec(header)?.[1]?.toLowerCase()
    if (word === undefined) return BEAUTIFUL_MERMAID
    const official = OFFICIAL_MERMAID_DIAGRAMS.get(word)
    if (official) return { engine: 'mermaid', name: official }
    const unsupported = UNSUPPORTED_DIAGRAMS.get(word)
    return unsupported ? { engine: 'unsupported', name: unsupported } : BEAUTIFUL_MERMAID
}

/**
 * Which engine draws the diagram, read from its header after any front matter, `%%` comments and accessibility
 * lines. beautiful-mermaid draws its six types, and text with no header or one nobody knows, so its parser can
 * quote it. The official `mermaid` package draws the types in OFFICIAL_MERMAID_DIAGRAMS, and nothing draws ZenUML.
 */
export function chooseDiagramEngine(source: string): DiagramEngine {
    const { lines, headerIndex } = readableLines(source)
    return engineForHeader(lines[headerIndex])
}

/** A type's name in the singular (`Pie chart`): every name is a plural that ends in s. */
export function singularDiagramName(name: string): string {
    return name.slice(0, -1)
}

/**
 * For a type Scrivon can't draw (ZenUML), named in the plural, the line an exported file shows its readers in
 * its place: `ZenUML diagram: not supported in Scrivon yet`. The preview's help would be out of place there.
 */
export function unsupportedDiagramNote(name: string): string {
    return `${singularDiagramName(name)}: not supported in Scrivon yet`
}

/**
 * The text to give beautiful-mermaid. Throws an error that names the types Scrivon draws when the diagram is
 * one it can't draw at all (ZenUML), instead of the parser's "Invalid mermaid header". A type the official
 * package draws is only tidied (front matter, comments and accessibility lines blanked): it never reaches
 * beautiful-mermaid, but the alt text reads it this way.
 */
export function prepareMermaidSource(source: string): string {
    const { lines, headerIndex } = readableLines(source)
    if (headerIndex === -1) return lines.join('\n')

    const choice = engineForHeader(lines[headerIndex])
    if (choice.engine === 'unsupported') throw new Error(unsupportedDiagramMessage(choice.name))
    if (choice.engine === 'mermaid') return lines.join('\n')

    const flowchart = FLOWCHART_HEADER.exec(lines[headerIndex]!)
    if (!flowchart) {
        lines[headerIndex] = withoutTrailingSemicolon(lines[headerIndex]!)
        return lines.join('\n')
    }

    const tidied = lines.flatMap((line, i) => (i < headerIndex ? [line] : flowchartStatements(line)))
    // The header is now alone on its line. Without a direction, Mermaid draws top-down.
    const header = tidied[headerIndex]!.trimEnd()
    tidied[headerIndex] = flowchart[1] ? header : `${header} TD`
    return tidied.join('\n')
}
