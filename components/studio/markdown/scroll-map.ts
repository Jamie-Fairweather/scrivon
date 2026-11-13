/** A place both panes can show at their top: how far the editor and the preview are scrolled to get there. */
export type ScrollPair = { editor: number; preview: number }

export type ScrollPane = keyof ScrollPair

/**
 * The places the editor and the preview line up at, in order: both tops, each block, and both ends (`end` is how
 * far each pane can scroll). A block that would make either pane go back up is left out, such as footnotes, which
 * the preview shows at the end wherever they are written. With a pane that can't scroll, only the tops are left.
 */
export function scrollPairs(points: readonly ScrollPair[], end: ScrollPair): ScrollPair[] {
    const pairs: ScrollPair[] = [{ editor: 0, preview: 0 }]
    if (end.editor <= 0 || end.preview <= 0) return pairs
    const inOrder = [...points].sort((a, b) => a.preview - b.preview || a.editor - b.editor)
    for (const point of inOrder) {
        const last = pairs[pairs.length - 1]!
        const goesDown = point.editor > last.editor && point.preview > last.preview
        const beforeEnd = point.editor < end.editor && point.preview < end.preview
        if (goesDown && beforeEnd) pairs.push(point)
    }
    pairs.push(end)
    return pairs
}

/**
 * How far to scroll the other pane when `from` is scrolled to `position`: the same share of the way between the
 * two places either side that line up (see {@link scrollPairs}).
 */
export function matchScroll(pairs: readonly ScrollPair[], from: ScrollPane, position: number): number {
    const to: ScrollPane = from === 'editor' ? 'preview' : 'editor'
    const first = pairs[0]!
    const last = pairs[pairs.length - 1]!
    if (position <= first[from]) return first[to]
    if (position >= last[from]) return last[to]
    // pairs[low] is at or above the position, pairs[high] below it.
    let low = 0
    let high = pairs.length - 1
    while (high - low > 1) {
        const middle = (low + high) >> 1
        if (pairs[middle]![from] <= position) low = middle
        else high = middle
    }
    const above = pairs[low]!
    const below = pairs[high]!
    const share = (position - above[from]) / (below[from] - above[from])
    return above[to] + share * (below[to] - above[to])
}
