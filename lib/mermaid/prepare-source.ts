import { withoutAccessibilityLines } from '@/lib/mermaid/accessibility'

/**
 * Tidies Mermaid text before beautiful-mermaid reads it, so common input that Mermaid itself accepts
 * draws here too. Lines are blanked rather than removed, except where one line holds several statements.
 */

/** The diagram types beautiful-mermaid draws, with the header that starts each one. */
export const SUPPORTED_DIAGRAMS = [
    { name: 'Flowcharts', header: 'flowchart TD or graph LR' },
    { name: 'Sequence diagrams', header: 'sequenceDiagram' },
    { name: 'Class diagrams', header: 'classDiagram' },
    { name: 'State diagrams', header: 'stateDiagram-v2' },
    { name: 'Entity relationship diagrams', header: 'erDiagram' },
    { name: 'XY charts', header: 'xychart-beta' },
] as const

/** Other Mermaid diagram types, by their header in lower case without `-beta`. Each name is a plural ending in s. */
export const UNSUPPORTED_DIAGRAMS: ReadonlyMap<string, string> = new Map(
    Object.entries({
        pie: 'Pie charts',
        gantt: 'Gantt charts',
        mindmap: 'Mind maps',
        journey: 'User journeys',
        gitgraph: 'Git graphs',
        timeline: 'Timelines',
        quadrantchart: 'Quadrant charts',
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
        zenuml: 'ZenUML diagrams',
    })
)

/** The supported types for a sentence: `flowcharts, sequence diagrams, … and XY charts`. */
export function supportedDiagramsSentence(): string {
    // Lower case, except a name that starts with an initialism (XY).
    const names = SUPPORTED_DIAGRAMS.map(({ name }) => (/^[A-Z]{2}/.test(name) ? name : name[0]!.toLowerCase() + name.slice(1)))
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** The preview card's help for a type it can't draw: `Pie charts aren't supported yet. Scrivon can draw:` and the list. */
function unsupportedMessage(name: string): string {
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
function blankFrontMatter(lines: string[]): void {
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

/** `%%` comments and `%%{init}%%` settings. The renderer skips them, but not when they come before the header. */
function blankComments(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.trimStart().startsWith('%%')) lines[i] = ''
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
 * A flowchart line split at its semicolons (`A --> B; B --> C`), leaving those inside quotes, node
 * labels (`A[a;b]`, the flag `A>a;b]`), `|edge text|` and inline edge text (`-- a;b -->`) alone.
 * Empty statements (a trailing `;`) are dropped.
 */
function flowchartStatements(line: string): string[] {
    const statements: string[] = []
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
            statements.push(line.slice(start, i))
            start = i + 1
        } else if (edgeTextCloses && (char === '-' || char === '=')) {
            EDGE_TEXT_START.lastIndex = i
            if (!EDGE_TEXT_START.test(line)) continue
            const end = edgeTextEnd(line, i)
            if (end === -1) edgeTextCloses = false
            else i = end - 1
        }
    }
    statements.push(line.slice(start))
    const [first, ...rest] = statements
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

/** The name, in the plural, of the Mermaid type this header starts that Scrivon can't draw, if it is one. */
function unsupportedType(header: string | undefined): string | undefined {
    const word = header === undefined ? undefined : HEADER_WORD.exec(header)?.[1]?.toLowerCase()
    return word === undefined ? undefined : UNSUPPORTED_DIAGRAMS.get(word)
}

/**
 * For a Mermaid type Scrivon can't draw (a pie chart, say), the line an exported file shows its readers in
 * its place: `Pie chart: not supported in Scrivon yet`. The preview's help would be out of place there.
 * Null for any other diagram.
 */
export function unsupportedDiagramNote(source: string): string | null {
    const { lines, headerIndex } = readableLines(source)
    const name = unsupportedType(lines[headerIndex])
    // Every name is a plural that ends in s.
    return name ? `${name.slice(0, -1)}: not supported in Scrivon yet` : null
}

/**
 * The text to give beautiful-mermaid. Throws an error that names the supported types when the
 * diagram is a Mermaid type it can't draw (a pie chart, say), instead of its "Invalid mermaid header".
 */
export function prepareMermaidSource(source: string): string {
    const { lines, headerIndex } = readableLines(source)
    if (headerIndex === -1) return lines.join('\n')

    const unsupported = unsupportedType(lines[headerIndex])
    if (unsupported) throw new Error(unsupportedMessage(unsupported))

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
