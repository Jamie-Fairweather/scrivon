/**
 * Tells whatever reads the open folder's files that some of them may have changed on disk: another app saved,
 * added or removed one (as the folder's watcher sees it), or the window came back to the front (a folder that can't be
 * watched may have changed meanwhile). Nothing is said about which files: readers check their own copies' stamps.
 */
const listeners = new Set<() => void>()

/** Called by the workspace session when the watcher sees a change, and when the window gets focus again. */
export function notifyWorkspaceDiskChange(): void {
    for (const listener of listeners) listener()
}

/** Calls `listener` on each change. Returns the function that stops it. */
export function subscribeWorkspaceDiskChanges(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
