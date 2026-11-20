import { createGroupRegistry } from '@/components/studio/workspace/focused-editor-group'

/**
 * Scrolls the Markdown preview to a heading, by the id the preview gave it (without its `user-content-` prefix).
 * Each preview registers how (one per editor group); the focused group's is used. With no Markdown preview on
 * screen, asking does nothing.
 */
type RevealHeading = (id: string) => void

const previews = createGroupRegistry<RevealHeading>()

/** Called by the Markdown preview, with its editor group's id. Returns the function that removes it again. */
export function registerPreviewHeadingReveal(reveal: RevealHeading, groupId: string | null = null): () => void {
    return previews.register(reveal, groupId)
}

export function revealHeadingInPreview(id: string): void {
    previews.forFocused()?.(id)
}
