import type { Element, ElementContent, Root } from 'hast'
import { visit } from 'unist-util-visit'

function isMermaidCode(code: Element): boolean {
    const classes = code.properties.className
    const list = Array.isArray(classes) ? classes : typeof classes === 'string' ? classes.split(/\s+/) : []
    return list.some((name) => /^language-mermaid$/i.test(String(name)))
}

/**
 * Numbers the document's fenced blocks, from 0 in the order they are shown: Mermaid blocks on their own, other
 * code blocks on their own. It works on the HTML tree react-markdown renders (footnotes already moved to the end),
 * so the preview and extractMermaidBlockSources always agree, however many times React renders a block.
 */
export function numberFencedBlocks(tree: Root): void {
    let mermaid = 0
    let code = 0
    visit(tree, 'element', (node: Element) => {
        if (node.tagName !== 'pre') return
        const child = node.children[0]
        if (child?.type !== 'element' || child.tagName !== 'code') return
        if (isMermaidCode(child)) child.properties.dataMermaidOrdinal = mermaid++
        else child.properties.dataCodeOrdinal = code++
    })
}

/** Rehype plugin for {@link numberFencedBlocks}. */
export function rehypeFencedBlockOrdinals() {
    return numberFencedBlocks
}

function ordinal(value: unknown): number | null {
    return typeof value === 'number' ? value : null
}

/** A Mermaid block's position among the document's diagrams, or null when `code` isn't one. */
export function mermaidBlockOrdinal(code: Element | undefined): number | null {
    return ordinal(code?.properties.dataMermaidOrdinal)
}

/** A fenced code block's position among the document's code blocks, or null for inline code or a diagram. */
export function fencedCodeBlockOrdinal(code: Element | undefined): number | null {
    return ordinal(code?.properties.dataCodeOrdinal)
}

function textOf(node: Element | ElementContent): string {
    if (node.type === 'text') return node.value
    if (node.type === 'element') return node.children.map(textOf).join('')
    return ''
}

/**
 * A fenced block's text, as the preview shows it. Read from the tree, so tags inside a raw-HTML
 * `<pre><code>` (`git <b>commit</b>`) give their words.
 */
export function codeBlockText(code: Element): string {
    return textOf(code).replace(/\n$/, '')
}

/** A Mermaid block's text, as the preview hands it to the diagram. */
export const mermaidBlockText = codeBlockText

/** A Mermaid block's id, and the text it had when the document was last shown. */
export type MermaidBlockIdentity = { id: string; source: string }

let lastBlockId = 0

/** Never handed out twice, so a new block can't pick up the pictures cached for an old one. */
function newBlockId(): string {
    lastBlockId += 1
    return `b${lastBlockId}`
}

/**
 * The id for each block in `sources`, carried over from `previous` (the last pass) so a block keeps its cached
 * picture and expanded view when blocks above it are added or removed. A block whose text didn't change keeps its
 * id wherever it moved. Of the rest, with as many blocks as before, a block keeps the id of the one at its position
 * (it is being edited); with blocks added or removed, only changed blocks next to the start or the end of the run
 * of matches are taken as edits. Every other block is new, and gets an id no block has had before.
 */
export function matchMermaidBlockIds(previous: readonly MermaidBlockIdentity[], sources: readonly string[], createId = newBlockId): string[] {
    const ids: (string | undefined)[] = sources.map(() => undefined)
    const taken = new Set<number>()
    sources.forEach((source, index) => {
        const at = previous.findIndex((block, position) => !taken.has(position) && block.source === source)
        if (at === -1) return
        taken.add(at)
        ids[index] = previous[at]!.id
    })

    /** Gives block `index` the id of previous block `at`. False when either one already has a partner. */
    const pair = (index: number, at: number): boolean => {
        if (ids[index] !== undefined || taken.has(at)) return false
        taken.add(at)
        ids[index] = previous[at]!.id
        return true
    }
    const shared = Math.min(sources.length, previous.length)
    if (sources.length === previous.length) {
        for (let index = 0; index < shared; index++) pair(index, index)
    } else {
        // Walk in from each end, past blocks that both passes have, and stop at the first block only one side has.
        for (let index = 0; index < shared; index++) {
            const bothMatched = ids[index] !== undefined && taken.has(index)
            if (!bothMatched && !pair(index, index)) break
        }
        for (let back = 1; back <= shared; back++) {
            const index = sources.length - back
            const at = previous.length - back
            const bothMatched = ids[index] !== undefined && taken.has(at)
            if (!bothMatched && !pair(index, at)) break
        }
    }
    return ids.map((id) => id ?? createId())
}

const MAX_REMEMBERED_DOCUMENTS = 100
/** Each document's blocks as last shown, so the ids also survive the preview unmounting (a diagram tab in front). */
const blocksByDocument = new Map<string, MermaidBlockIdentity[]>()

/**
 * Rehype plugin, run after {@link rehypeFencedBlockOrdinals}, that puts a lasting id on each Mermaid block's code
 * element next to its ordinal (see {@link matchMermaidBlockIds}). The ordinal still names the block ("Expand
 * diagram 2") and finds its source; the id keys its render cache, so it never shows another block's picture.
 */
export function rehypeMermaidBlockIds(documentKey: string) {
    return () => (tree: Root) => {
        const codes: Element[] = []
        visit(tree, 'element', (node: Element) => {
            if (mermaidBlockOrdinal(node) !== null) codes.push(node)
        })
        const sources = codes.map(mermaidBlockText)
        const ids = matchMermaidBlockIds(blocksByDocument.get(documentKey) ?? [], sources)
        codes.forEach((code, index) => {
            code.properties.dataMermaidBlockId = ids[index]
        })
        blocksByDocument.delete(documentKey)
        blocksByDocument.set(
            documentKey,
            sources.map((source, index) => ({ id: ids[index]!, source }))
        )
        for (const oldest of blocksByDocument.keys()) {
            if (blocksByDocument.size <= MAX_REMEMBERED_DOCUMENTS) break
            blocksByDocument.delete(oldest)
        }
    }
}

/** The lasting id {@link rehypeMermaidBlockIds} gave a Mermaid block, or null when `code` isn't one. */
export function mermaidBlockKey(code: Element | undefined): string | null {
    const id = code?.properties.dataMermaidBlockId
    return typeof id === 'string' ? id : null
}
