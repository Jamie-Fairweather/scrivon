/**
 * Puts keyboard focus in the code editor once it shows a file the user just opened or created (from the
 * palette, or the explorer's New menu), so typing goes straight into the file. The editor panel registers
 * how; with no editor panel, or with the editor hidden, asking does nothing.
 */
type FocusEditorFor = (path: string) => void

let registered: FocusEditorFor | null = null

/** Called by the editor panel. Returns the function that removes it again. */
export function registerEditorFocus(focus: FocusEditorFor): () => void {
    registered = focus
    return () => {
        if (registered === focus) registered = null
    }
}

/**
 * Call once opening `path` has finished. If its tab is then the one showing, the editor takes focus (now,
 * or as soon as it has loaded). If the open didn't happen (declined, failed), nothing changes.
 */
export function focusEditorFor(path: string): void {
    registered?.(path)
}
