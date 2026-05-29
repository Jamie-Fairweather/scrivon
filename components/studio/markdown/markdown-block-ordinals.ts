/** Resets at the start of each MarkdownPreview render so block ordinals stay 0..n within one pass. */
let mermaidBlockOrdinal = 0
let fencedCodeBlockOrdinal = 0

export function resetMarkdownBlockOrdinals(): void {
    mermaidBlockOrdinal = 0
    fencedCodeBlockOrdinal = 0
}

export function nextMermaidBlockOrdinal(): number {
    return mermaidBlockOrdinal++
}

export function nextFencedCodeBlockOrdinal(): number {
    return fencedCodeBlockOrdinal++
}
