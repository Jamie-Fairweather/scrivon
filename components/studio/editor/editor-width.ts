export const MIN_EDITOR_WIDTH = 280
/** Room always left for the preview next to the editor. */
export const MIN_PREVIEW_WIDTH = 240
const MAX_WIDTH_RATIO = 0.6

/** The widest the editor may be in a row: 60% of it, leaving room for the preview. */
export function maxEditorWidth(rowWidth: number): number {
    return Math.round(Math.max(MIN_EDITOR_WIDTH, Math.min(rowWidth * MAX_WIDTH_RATIO, rowWidth - MIN_PREVIEW_WIDTH)))
}

/**
 * Fits an editor width into the row it shares with the preview: at most 60% of the row,
 * and never so wide that the preview (and the editor's own resize handle) is pushed out.
 */
export function clampEditorWidth(width: number, rowWidth: number): number {
    return Math.round(Math.min(maxEditorWidth(rowWidth), Math.max(MIN_EDITOR_WIDTH, width)))
}
