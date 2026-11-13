import { readDiagramAccessibility, withoutAccessibilityLines } from '@/lib/mermaid/accessibility'
import { prepareMermaidSource, readFrontMatterTitle } from '@/lib/mermaid/prepare-source'

/** Alt text for an exported diagram. `name` is short, for lists of pictures; `description` is what a screen reader reads. */
export type DiagramAltText = { name: string; description: string }

type Kind = 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'xychart' | 'other'

const KINDS: [pattern: RegExp, kind: Kind, label: string][] = [
    [/^(?:flowchart|graph)\b/i, 'flowchart', 'Flowchart'],
    [/^sequencediagram\b/i, 'sequence', 'Sequence diagram'],
    [/^classdiagram\b/i, 'class', 'Class diagram'],
    [/^statediagram(?:-v2)?\b/i, 'state', 'State diagram'],
    [/^erdiagram\b/i, 'er', 'Entity relationship diagram'],
    [/^xychart(?:-beta)?\b/i, 'xychart', 'Chart'],
]

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
    const labels: string[] = []
    const add = (text: string | undefined) => {
        const label = text ? cleanLabel(text) : ''
        if (label && label !== '[*]' && !labels.includes(label)) labels.push(label)
    }
    /** A participant written `participant A as Alice`, or a state `state "Long name" as L`, goes by its short id later on. */
    const aliases = new Map<string, string>()
    for (const line of lines) {
        if (kind === 'flowchart') {
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
    return labels
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

/**
 * Alt text for a Mermaid diagram, so each exported picture can be told apart. Uses the diagram's own
 * `accTitle` and `accDescr` when it has them, then a `title` in its front matter or the chart, and
 * otherwise says what kind of diagram it is and names its first few nodes or participants.
 */
export function diagramAltText(source: string): DiagramAltText {
    // The same tidy-up the renderer uses, so the alt text never reads a line the picture still draws.
    const accessibility = readDiagramAccessibility(source)
    const lines = renderedText(source)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('%%'))
    const found = KINDS.find(([pattern]) => pattern.test(lines[0] ?? ''))
    const kind: Kind = found?.[1] ?? 'other'
    const kindLabel = found?.[2] ?? 'Diagram'
    const givenTitle = accessibility.title ?? readFrontMatterTitle(source)
    let title = givenTitle ? cleanLabel(givenTitle) : ''
    const description = accessibility.description ? cleanLabel(accessibility.description) : ''
    const body: string[] = []
    for (const line of lines.slice(1)) {
        const chartTitle = kind === 'xychart' || kind === 'sequence' ? /^title(?:\s*:\s*|\s+)(.+)$/i.exec(line) : null
        if (chartTitle) title ||= cleanLabel(chartTitle[1]!)
        else body.push(line)
    }
    if (title || description) {
        const name = title || kindLabel
        const full = title && description ? `${title}${/[.!?:]$/.test(title) ? '' : '.'} ${description}` : title || description
        return { name, description: full }
    }
    const labels = labelsFor(kind, body)
    return { name: kindLabel, description: labels.length > 0 ? `${kindLabel}: ${joinLabels(labels)}` : kindLabel }
}
