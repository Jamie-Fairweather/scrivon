import type { Parent, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'

/**
 * Whether `$…$` is math by Pandoc's rule: no space just inside either `$`, and no digit straight after the closing
 * one. So `$5 and $10` stays as prices. `$$…$$` is always math.
 */
function isMath(source: string, after: string): boolean {
    if (source.startsWith('$$')) return true
    const inner = source.slice(1, -1)
    return !/^\s|\s$/.test(inner) && !/^\d/.test(after)
}

/** Joins text nodes that now sit side by side, so a price reads as one run of text again. */
function joinTexts(parent: Parent): void {
    const children: Parent['children'] = []
    for (const child of parent.children) {
        const last = children.at(-1)
        if (child.type === 'text' && last?.type === 'text') {
            last.value += child.value
            if (last.position && child.position) last.position = { start: last.position.start, end: child.position.end }
        } else children.push(child)
    }
    parent.children = children
}

/** Turns `$…$` that isn't math by {@link isMath} back into the text it was written as. */
export function remarkMathPricesAsText() {
    return (tree: Root, file: VFile) => {
        const text = typeof file.value === 'string' ? file.value : ''
        const changed = new Set<Parent>()
        visit(tree, 'inlineMath', (node, index, parent) => {
            if (!parent || index === undefined) return
            const start = node.position?.start.offset
            const end = node.position?.end.offset
            const source = text && start !== undefined && end !== undefined ? text.slice(start, end) : `$${node.value}$`
            const next = parent.children[index + 1]
            if (isMath(source, next?.type === 'text' ? next.value : '')) return
            parent.children[index] = { type: 'text', value: source, position: node.position } satisfies Text
            changed.add(parent)
        })
        changed.forEach(joinTexts)
    }
}
