import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { PaletteFile } from '@/components/studio/command-palette/palette-prefixes'
import type { DiagramPartPaletteItem } from '@/components/studio/command-palette/types'
import { readDiagramTargets, type DiagramTarget } from '@/lib/mermaid/diagram-targets'
import { diagramPartsKind, locateDiagramTarget, type DiagramPartsKind } from '@/lib/mermaid/source-locations'
import { readCachedSvg, readLatestSvg, readRenderError, readSvgForSource } from '@/lib/mermaid/svg-cache'

/** What '@' says in a diagram that lists nothing. */
export const DIAGRAM_PART_HINTS = {
    showPreview: "Show the preview to list the diagram's parts.",
    fixError: "Fix the diagram's error to list its parts.",
    unsupported: 'Only flowchart, state and sequence diagrams list their parts so far.',
    none: 'No parts to list yet.',
    noMatch: 'No matching parts.',
} as const

export type DiagramPartRows = { items: DiagramPartPaletteItem[]; hint: string | null }

type DiagramPartQuery = {
    file: PaletteFile
    /** The tab's id: the key the canvas keeps its renders under. */
    tabId: string
    themeId: string
    previewOpen: boolean
    query: string
}

const KIND_NAMES: Record<Exclude<DiagramPartsKind, 'other'>, Partial<Record<DiagramTarget['kind'], string>>> = {
    flowchart: { node: 'Node', group: 'Subgraph', edge: 'Link' },
    state: { node: 'State', group: 'State', edge: 'Transition' },
    sequence: { actor: 'Participant', message: 'Message' },
}

const PSEUDO_STATE = /^_(?:start|end)\d*$/

/**
 * The SVG the canvas shows for this text and theme, as the canvas picks it (use-mermaid-svg.ts): this text's render,
 * or while it has an error, the last that worked. Null, with why, when it shows none.
 */
function shownSvg(tabId: string, themeId: string, content: string): { svg: string } | { hint: string } {
    const trimmed = content.trim()
    const current = readCachedSvg(themeId, tabId, trimmed) ?? readSvgForSource(themeId, trimmed)
    if (current) return { svg: current }
    if (readRenderError(themeId, tabId, trimmed) === null) return { hint: DIAGRAM_PART_HINTS.showPreview }
    const older = readLatestSvg(themeId, tabId, trimmed)
    return older ? { svg: older } : { hint: DIAGRAM_PART_HINTS.fixError }
}

/**
 * The open `.mmd` diagram's parts for '@', read from the picture the canvas shows (diagram-targets.ts) and found in
 * the file's text (source-locations.ts), in the order they are written. Parts the text no longer has (the picture is
 * from before an error) are left out. With nothing to list, `hint` says why.
 */
export function diagramPartRows({ file, tabId, themeId, previewOpen, query }: DiagramPartQuery): DiagramPartRows {
    const none = (hint: string): DiagramPartRows => ({ items: [], hint })
    const kind = diagramPartsKind(file.content)
    if (kind === 'other') return none(file.content.trim() ? DIAGRAM_PART_HINTS.unsupported : DIAGRAM_PART_HINTS.none)
    if (!previewOpen) return none(DIAGRAM_PART_HINTS.showPreview)
    const shown = shownSvg(tabId, themeId, file.content)
    if ('hint' in shown) return none(shown.hint)

    const { targets } = readDiagramTargets(shown.svg)
    const names = new Map(targets.filter((target) => target.id).map((target) => [target.id, target.label || target.id]))
    const nameOf = (id: string) => names.get(id) ?? (PSEUDO_STATE.test(id) ? '[*]' : id)

    const items: DiagramPartPaletteItem[] = []
    for (const target of targets) {
        const type = KIND_NAMES[kind][target.kind]
        const place = type ? locateDiagramTarget(file.content, target) : null
        if (!type || !place) continue
        const joined = target.from || target.to ? `${nameOf(target.from)} → ${nameOf(target.to)}` : ''
        const name = joined ? (target.label ? `${joined}: ${target.label}` : joined) : target.label || target.id
        items.push({
            kind: 'diagram-part',
            value: `part:${target.kind}:${target.id}:${target.from}:${target.to}:${target.occurrence}`,
            searchText: `${type}: ${name}`,
            path: file.path,
            type,
            name,
            ...place,
        })
    }
    if (items.length === 0) return none(DIAGRAM_PART_HINTS.none)
    items.sort((a, b) => a.line - b.line || a.column - b.column)
    if (!query) return { items, hint: null }
    const ranked = fuzzyRank(items, query, (item) => item.searchText).map(({ item }) => item)
    return ranked.length > 0 ? { items: ranked, hint: null } : none(DIAGRAM_PART_HINTS.noMatch)
}
