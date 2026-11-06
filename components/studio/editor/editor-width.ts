export const MIN_EDITOR_WIDTH = 280
/** Room always left for the preview next to the editor. */
export const MIN_PREVIEW_WIDTH = 240
const MAX_WIDTH_RATIO = 0.6

/**
 * Fits an editor width into the row it shares with the preview: at most 60% of the row,
 * and never so wide that the preview (and the editor's own resize handle) is pushed out.
 */
export function clampEditorWidth(width: number, rowWidth: number): number {
    const maxWidth = Math.max(MIN_EDITOR_WIDTH, Math.min(rowWidth * MAX_WIDTH_RATIO, rowWidth - MIN_PREVIEW_WIDTH))
    return Math.round(Math.min(maxWidth, Math.max(MIN_EDITOR_WIDTH, width)))
}
