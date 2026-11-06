import type { Element, Root } from 'hast'
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
