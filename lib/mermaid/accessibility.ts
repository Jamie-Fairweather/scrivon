/**
 * Mermaid's accessibility lines: `accTitle: …`, `accDescr: …`, and `accDescr { … }` over several
 * lines. beautiful-mermaid doesn't know them and draws them as stray nodes, so they are blanked out
 * before rendering, and used instead to name the diagram for screen readers.
 */

export type DiagramAccessibility = { title: string | null; description: string | null }

const SINGLE_LINE = /^[ \t]*(accTitle|accDescr)[ \t]*:[ \t]*(.*?)[ \t]*$/
const BLOCK_START = /^[ \t]*accDescr[ \t]*\{(.*)$/

type Scan = DiagramAccessibility & { lines: string[]; found: boolean }

function scan(source: string): Scan {
    const result: Scan = { title: null, description: null, lines: source.split('\n'), found: false }
    if (!source.includes('acc')) return result

    const { lines } = result
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '')
        const single = SINGLE_LINE.exec(line)
        if (single) {
            const text = single[2] || null
            if (single[1] === 'accTitle') result.title = text
            else result.description = text
            lines[i] = ''
            result.found = true
            continue
        }

        const block = BLOCK_START.exec(line)
        if (!block) continue
        const parts: string[] = []
        let rest = block[1]
        let end = i
        let close = rest.indexOf('}')
        while (close === -1 && end + 1 < lines.length) {
            parts.push(rest)
            rest = lines[++end].replace(/\r$/, '')
            close = rest.indexOf('}')
        }
        // Not closed yet (still being typed): leave it for the parser, like any half-typed line.
        if (close === -1) continue
        parts.push(rest.slice(0, close))
        result.description =
            parts
                .map((part) => part.trim())
                .filter(Boolean)
                .join(' ') || null
        // Blank the lines rather than remove them, so parse errors still point at the right line.
        for (let blank = i; blank <= end; blank++) lines[blank] = ''
        result.found = true
        i = end
    }
    return result
}

/** The diagram's own name and description, from its accTitle and accDescr lines. */
export function readDiagramAccessibility(source: string): DiagramAccessibility {
    const { title, description } = scan(source)
    return { title, description }
}

/** The source with its accessibility lines blanked, ready for beautiful-mermaid. */
export function withoutAccessibilityLines(source: string): string {
    const { lines, found } = scan(source)
    return found ? lines.join('\n') : source
}
