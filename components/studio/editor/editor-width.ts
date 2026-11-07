export const MIN_EDITOR_WIDTH = 280
/** Room always left for the preview next to the editor. */
export const MIN_PREVIEW_WIDTH = 240
/** How narrow the editor may get when the row has no room for both minimums. */
const NARROW_ROW_EDITOR_WIDTH = 160
const MAX_WIDTH_RATIO = 0.6

/**
 * The widest the editor may be in a row: 60% of it, leaving room for the preview. In a row too
 * narrow for both minimums, both give up space, and the editor still takes at most 60%.
 */
export function maxEditorWidth(rowWidth: number): number {
    const widest = rowWidth * MAX_WIDTH_RATIO
    return Math.round(Math.max(Math.min(NARROW_ROW_EDITOR_WIDTH, widest), Math.min(widest, rowWidth - MIN_PREVIEW_WIDTH)))
}

/** The narrowest the editor may be in a row: 280px, or less when the row is narrow. */
export function minEditorWidth(rowWidth: number): number {
    return Math.min(MIN_EDITOR_WIDTH, maxEditorWidth(rowWidth))
}

/**
 * Fits an editor width into the row it shares with the preview: at most 60% of the row,
 * and never so wide that the preview (and the editor's own resize handle) is pushed out.
 */
export function clampEditorWidth(width: number, rowWidth: number): number {
    return Math.round(Math.min(maxEditorWidth(rowWidth), Math.max(minEditorWidth(rowWidth), width)))
}
