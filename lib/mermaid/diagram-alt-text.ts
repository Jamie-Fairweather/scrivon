import { readDiagramAccessibility, withoutAccessibilityLines } from '@/lib/mermaid/accessibility'
import { OFFICIAL_MERMAID_DIAGRAMS, prepareMermaidSource, readFrontMatterTitle, singularDiagramName } from '@/lib/mermaid/prepare-source'

/** Alt text for an exported diagram. `name` is short, for lists of pictures; `description` is what a screen reader reads. */
export type DiagramAltText = { name: string; description: string }

/** `official` is a type the official mermaid package draws: a pie chart, say. */
type Kind = 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'xychart' | 'pie' | 'official' | 'other'

/**
 * The official package's types whose grammar has a `title` statement (`title Release plan`), by their header as
 * OFFICIAL_MERMAID_DIAGRAMS writes it. A mind map, kanban board, block, Sankey or requirement diagram has none: a
 * `title …` line there is a node or a card, and names nothing.
 */
const OFFICIAL_TITLED: ReadonlySet<string> = new Set([
    'pie',
    'gantt',
    'journey',
    'gitgraph',
    'timeline',
    'quadrantchart',
    'c4context',
    'c4container',
    'c4component',
    'c4dynamic',
    'c4deployment',
    'packet',
    'architecture',
    'radar',
    'treemap',
])

/** A kind, its name in the alt text, and whether its own `title` line (`title Pets`, `title: Pets`) names the diagram. */
type KindInfo = { kind: Kind; label: string; titled: boolean }

const KINDS: [pattern: RegExp, info: KindInfo][] = [
    [/^(?:flowchart|graph)\b/i, { kind: 'flowchart', label: 'Flowchart', titled: false }],
    [/^sequencediagram\b/i, { kind: 'sequence', label: 'Sequence diagram', titled: true }],
    [/^classdiagram\b/i, { kind: 'class', label: 'Class diagram', titled: false }],
    [/^statediagram(?:-v2)?\b/i, { kind: 'state', label: 'State diagram', titled: false }],
    [/^erdiagram\b/i, { kind: 'er', label: 'Entity relationship diagram', titled: false }],
    [/^xychart(?:-beta)?\b/i, { kind: 'xychart', label: 'Chart', titled: true }],
    // `Pie chart`, `Gantt chart`, `Mind map` and so on, as the engine choice names them. A pie chart may also put its
    // title on its header.
    ...[...OFFICIAL_MERMAID_DIAGRAMS].map(([header, name]): [RegExp, KindInfo] => [
        new RegExp(`^${header}(?:-beta)?\\b`, 'i'),
        { kind: header === 'pie' ? 'pie' : 'official', label: singularDiagramName(name), titled: OFFICIAL_TITLED.has(header) },
    ]),
]

const OTHER_KIND: KindInfo = { kind: 'other', label: 'Diagram', titled: false }

const TITLE_LINE = /^title(?:\s*:\s*|\s+)(.+)$/i
const PIE_HEADER_TITLE = /^pie\b(?:\s+showData)?\s+title\s+(.+)$/i
/** A pie slice: `"Dogs" : 386`. */
const PIE_SLICE = /^"([^"]+)"\s*:/

/** How many labels the description names before it says how many more there are. */
const MAX_LABELS = 5

/**
 * Text with its tags taken out, repeated until none are left. This only tidies what is read aloud: every
 * caller still escapes the result, so it isn't what keeps HTML out.
 */
function withoutTags(text: string): string {
    let previous: string
    do {
        previous = text
        text = text.replace(/<[^>]*>/g, '')
    } while (text !== previous)
    return text
}

/** A label as it reads on the diagram: no quotes, tags, or Markdown backticks, and `<br>` as a space. */
function cleanLabel(text: string): string {
    return withoutTags(text.replace(/<br\s*\/?>/gi, ' '))
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Flowchart node text: `A[Start]`, `B(Round)`, `C{Choice}`, `D((Circle))`, `E>Flag]`, `F[/Slant/]` and so on. */
const FLOWCHART_NODE =
    /(?:^|[^\w-])[A-Za-z0-9_]+\s*(?:\[\[|\[\(|\(\[|\(\(\(|\(\(|\{\{|\[|\(|\{|>)[/\\]?\s*("[^"]*"|[^[\](){}"|]+?)\s*[/\\]?(?:\]\]|\)\]|\]\)|\)\)\)|\)\)|\}\}|\]|\)|\})/g
const FLOWCHART_SKIP = /^(?:subgraph|end|classDef|class|style|linkStyle|click|direction)\b/i
/** Two ends of a relationship line in class, state, and ER diagrams. */
const RELATION = /^("[^"]+"|\[\*\]|[\w.~-]+)\s*(?:"[^"]*"\s*)?[<>|*o}{.x-]*(?:--|\.\.)[<>|*o}{.x-]*\s*(?:"[^"]*"\s*)?("[^"]+"|\[\*\]|[\w.~-]+)/

function labelsFor(kind: Kind, lines: string[]): string[] {
    // A set, so a long diagram is read in one pass: each label is looked up rather than searched for.
    const labels = new Set<string>()
    const add = (text: string | undefined) => {
        const label = text ? cleanLabel(text) : ''
        if (label && label !== '[*]') labels.add(label)
    }
    /** A participant written `participant A as Alice`, or a state `state "Long name" as L`, goes by its short id later on. */
    const aliases = new Map<string, string>()
    for (const line of lines) {
        if (kind === 'pie') {
            add(PIE_SLICE.exec(line)?.[1])
        } else if (kind === 'flowchart') {
            if (FLOWCHART_SKIP.test(line)) continue
            for (const match of line.matchAll(FLOWCHART_NODE)) add(match[1])
        } else if (kind === 'sequence') {
            const participant = /^(?:participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line)
            if (participant) {
                if (participant[2]) aliases.set(participant[1]!, participant[2])
                add(participant[2] ?? participant[1])
            } else {
                const message = /^([^:]+?)\s*(?:--?(?:>>|>|x|\))|<<--?>>)\s*[+-]?\s*([^:]+?)\s*:/.exec(line)
                if (message) [message[1]!, message[2]!].forEach((id) => add(aliases.get(id) ?? id))
            }
        } else if (kind === 'class' || kind === 'state' || kind === 'er') {
            const declared = /^(?:class|state)\s+("[^"]+"|[\w.~-]+)(?:\s+as\s+([\w.-]+))?/i.exec(line)
            const entity = kind === 'er' ? /^("[^"]+"|[\w-]+)\s*\{/.exec(line) : null
            const relation = RELATION.exec(line)
            if (declared) {
                if (declared[2]) aliases.set(declared[2], cleanLabel(declared[1]!))
                add(declared[1])
            } else if (entity) add(entity[1])
            else if (relation) [relation[1]!, relation[2]!].forEach((id) => add(aliases.get(id) ?? id))
        }
    }
    return [...labels]
}

function joinLabels(labels: string[]): string {
    const shown = labels.slice(0, MAX_LABELS)
    const more = labels.length - shown.length
    return more > 0 ? `${shown.join(', ')}, and ${more} more` : shown.join(', ')
}

/** The text the renderer reads: front matter and comments left out, one statement per line. */
function renderedText(source: string): string {
    try {
        return prepareMermaidSource(source)
    } catch {
        // A diagram type Scrivon can't draw yet.
        return withoutAccessibilityLines(source)
    }
}

function readableLines(source: string): string[] {
    return renderedText(source)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('%%'))
}

function findKind(header: string | undefined): KindInfo {
    return KINDS.find(([pattern]) => pattern.test(header ?? ''))?.[1] ?? OTHER_KIND
}

/** What kind of diagram it is, as the alt text names it: `Flowchart`, `Pie chart`, `Mind map`, or `Diagram`. */
export function diagramKindName(source: string): string {
    return findKind(readableLines(source)[0]).label
}

type NamedDiagram = {
    info: KindInfo
    /** The diagram's own name: its accTitle, front matter title or chart title. Empty when it has none. */
    title: string
    /** Its accDescr. Empty when it has none. */
    description: string
    /** The lines after the header, less the chart title, to name the nodes from. */
    body: string[]
}

/** The diagram's kind, its own title and description, and the rest of its lines, from one read of the text. */
function readNamedDiagram(source: string): NamedDiagram {
    // The same tidy-up the renderer uses, so the alt text never reads a line the picture still draws.
    const accessibility = readDiagramAccessibility(source)
    const lines = readableLines(source)
    const info = findKind(lines[0])
    const givenTitle = accessibility.title ?? readFrontMatterTitle(source)
    let title = givenTitle ? cleanLabel(givenTitle) : ''
    const description = accessibility.description ? cleanLabel(accessibility.description) : ''
    const headerTitle = info.kind === 'pie' ? PIE_HEADER_TITLE.exec(lines[0] ?? '') : null
    if (headerTitle) title ||= cleanLabel(headerTitle[1]!)
    const body: string[] = []
    for (const line of lines.slice(1)) {
        const chartTitle = info.titled ? TITLE_LINE.exec(line) : null
        if (chartTitle) title ||= cleanLabel(chartTitle[1]!)
        else body.push(line)
    }
    return { info, title, description, body }
}

/**
 * The diagram's short name (diagramAltText's `name`) and its kind, without reading its nodes: the canvas labels
 * itself with this on every edit, so it stays quick for a long diagram. `name` equals `kind` when the diagram has
 * no title of its own.
 */
export function diagramName(source: string): { name: string; kind: string } {
    const { info, title } = readNamedDiagram(source)
    return { name: title || info.label, kind: info.label }
}

/**
 * Alt text for a Mermaid diagram, so each exported picture can be told apart. Uses the diagram's own
 * `accTitle` and `accDescr` when it has them, then a `title` in its front matter or the chart, and
 * otherwise says what kind of diagram it is and names its first few nodes, participants or slices.
 */
export function diagramAltText(source: string): DiagramAltText {
    const { info, title, description, body } = readNamedDiagram(source)
    if (title || description) {
        const name = title || info.label
        const full = title && description ? `${title}${/[.!?:]$/.test(title) ? '' : '.'} ${description}` : title || description
        return { name, description: full }
    }
    const labels = labelsFor(info.kind, body)
    return { name: info.label, description: labels.length > 0 ? `${info.label}: ${joinLabels(labels)}` : info.label }
}
