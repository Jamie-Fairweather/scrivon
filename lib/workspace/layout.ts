/** Whether the preview is on screen. With the editor hidden too, it shows anyway. */
export function isPreviewShown(layout: { previewOpen: boolean; editorOpen: boolean }): boolean {
    return layout.previewOpen || !layout.editorOpen
}
