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

/** Other Mermaid diagram types, by their header in lower case without `-beta`. */
const UNSUPPORTED_DIAGRAMS = new Map(
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

function unsupportedMessage(name: string): string {
    const supported = SUPPORTED_DIAGRAMS.map((diagram) => `• ${diagram.name} (${diagram.header})`).join('\n')
    return `${name} aren't supported yet. Scrivon can draw:\n${supported}`
}

const FENCE = /^[ \t]*---[ \t]*\r?$/
const FLOWCHART_HEADER = /^[ \t]*(?:graph|flowchart)\b[ \t]*([^\s;]*)/i
const HEADER_WORD = /^[ \t]*([A-Za-z0-9]+)(?:-beta)?\b/

/** Front matter (`---` … `---` at the top) holds settings and a title; the renderer would read it as the header. */
function blankFrontMatter(lines: string[]): void {
    const start = lines.findIndex((line) => line.trim() !== '')
    if (start === -1 || !FENCE.test(lines[start]!)) return
    const end = lines.findIndex((line, i) => i > start && FENCE.test(line))
    if (end === -1) return
    for (let i = start; i <= end; i++) lines[i] = ''
}

/** `%%` comments and `%%{init}%%` settings. The renderer skips them, but not when they come before the header. */
function blankComments(lines: string[]): void {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.trimStart().startsWith('%%')) lines[i] = ''
    }
}

/**
 * A flowchart line split at its semicolons (`A --> B; B --> C`), leaving those inside quotes,
 * node labels and `|edge text|` alone. Empty statements (a trailing `;`) are dropped.
 */
function flowchartStatements(line: string): string[] {
    const statements: string[] = []
    let depth = 0
    let quoted = false
    let piped = false
    let start = 0
    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') quoted = !quoted
        else if (quoted) continue
        else if (char === '[' || char === '(' || char === '{') depth++
        else if ((char === ']' || char === ')' || char === '}') && depth > 0) depth--
        else if (char === '|' && depth === 0) piped = !piped
        else if (char === ';' && depth === 0 && !piped) {
            statements.push(line.slice(start, i))
            start = i + 1
        }
    }
    statements.push(line.slice(start))
    const [first, ...rest] = statements
    return [first!, ...rest.filter((statement) => statement.trim() !== '')]
}

/**
 * The text to give beautiful-mermaid. Throws an error that names the supported types when the
 * diagram is a Mermaid type it can't draw (a pie chart, say), instead of its "Invalid mermaid header".
 */
export function prepareMermaidSource(source: string): string {
    const lines = withoutAccessibilityLines(source).split('\n')
    blankFrontMatter(lines)
    blankComments(lines)

    const headerIndex = lines.findIndex((line) => line.trim() !== '')
    if (headerIndex === -1) return lines.join('\n')

    const word = HEADER_WORD.exec(lines[headerIndex]!)?.[1]?.toLowerCase()
    const unsupported = word === undefined ? undefined : UNSUPPORTED_DIAGRAMS.get(word)
    if (unsupported) throw new Error(unsupportedMessage(unsupported))

    const flowchart = FLOWCHART_HEADER.exec(lines[headerIndex]!)
    if (!flowchart) {
        lines[headerIndex] = lines[headerIndex]!.replace(/[ \t]*;[ \t]*(\r?)$/, '$1')
        return lines.join('\n')
    }

    const tidied = lines.flatMap((line, i) => (i < headerIndex ? [line] : flowchartStatements(line)))
    // The header is now alone on its line. Without a direction, Mermaid draws top-down.
    const header = tidied[headerIndex]!.trimEnd()
    tidied[headerIndex] = flowchart[1] ? header : `${header} TD`
    return tidied.join('\n')
}
