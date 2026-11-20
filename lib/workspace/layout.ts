import type { StudioLayoutState } from '@/lib/workspace/types'

/** Whether the preview is on screen. With the editor hidden too, it shows anyway. */
export function isPreviewShown(layout: { previewOpen: boolean; editorOpen: boolean }): boolean {
    return layout.previewOpen || !layout.editorOpen
}

/**
 * The panes on screen. In focus mode that is the editor alone, even when the saved layout hides it (Preview
 * Only). The saved layout itself is left as it is, so leaving focus mode brings it back.
 */
export function shownLayout(
    saved: { explorerOpen: boolean; editorOpen: boolean; previewOpen: boolean; outlineOpen: boolean },
    focusMode: boolean
): StudioLayoutState {
    if (focusMode) return { explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false }
    const { explorerOpen, editorOpen, previewOpen, outlineOpen } = saved
    return { explorerOpen, editorOpen, previewOpen: isPreviewShown({ previewOpen, editorOpen }), outlineOpen }
}
