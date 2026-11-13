/**
 * Scrolls the Markdown preview to a heading, by the id the preview gave it (without its `user-content-` prefix).
 * The preview registers how; with no Markdown preview on screen, asking does nothing.
 */
type RevealHeading = (id: string) => void

let registered: RevealHeading | null = null

/** Called by the Markdown preview. Returns the function that removes it again. */
export function registerPreviewHeadingReveal(reveal: RevealHeading): () => void {
    registered = reveal
    return () => {
        if (registered === reveal) registered = null
    }
}

export function revealHeadingInPreview(id: string): void {
    registered?.(id)
}
