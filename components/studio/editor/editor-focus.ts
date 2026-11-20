import { createGroupRegistry } from '@/components/studio/workspace/focused-editor-group'

/**
 * Puts keyboard focus in the code editor once it shows a file the user just opened or created (from the
 * palette, or the explorer's New menu), so typing goes straight into the file. Each editor panel (one per editor
 * group) registers how; with no editor panel, or with the editor hidden, asking does nothing.
 */
type FocusEditorFor = (path: string) => void

const focusFor: FocusEditorFor[] = []

/** How long a request for a group's editor that isn't there yet waits for it (Split Editor makes the group first). */
const NEW_GROUP_WAIT_MS = 2000
let waiting: { path: string; until: number } | null = null

/**
 * Called by each editor panel. Each one decides for itself whether the request is its own: the focused group's
 * editor, once it shows the file. Returns the function that removes it again.
 */
export function registerEditorFocus(focus: FocusEditorFor): () => void {
    focusFor.push(focus)
    // Split Editor or Move Tab to Other Group asked before this group's editor was made.
    if (waiting && waiting.until > Date.now()) focus(waiting.path)
    return () => {
        const index = focusFor.indexOf(focus)
        if (index !== -1) focusFor.splice(index, 1)
    }
}

/**
 * Call once opening `path` has finished. If its tab is then the one the focused group shows, that group's editor
 * takes focus (now, or as soon as it has loaded). If the open didn't happen (declined, failed), nothing changes.
 * With `inNewGroup`, the group may be one that is only just being made, and its editor takes the request when it
 * appears (for a moment only, so a later group doesn't take the keyboard out of the blue).
 */
export function focusEditorFor(path: string, { inNewGroup = false }: { inNewGroup?: boolean } = {}): void {
    waiting = inNewGroup ? { path, until: Date.now() + NEW_GROUP_WAIT_MS } : null
    for (const focus of [...focusFor]) focus(path)
}

/** For the editor that took a request made with `inNewGroup`: the others made later leave it alone. */
export function editorFocusTaken(path: string): void {
    if (waiting?.path === path) waiting = null
}

/** Focuses an editor now: true when it did. `root` is its pane, so F6 can focus the editor it lands on. */
type FocusNow = { focus: () => boolean; root: () => Element | null }

const focusNow = createGroupRegistry<FocusNow>()

/**
 * Called by each editor panel, with a function that focuses its editor at once and its pane element. Returns the
 * function that removes it again.
 */
export function registerEditorFocusNow(focus: () => boolean, groupId: string | null = null, root: () => Element | null = () => null): () => void {
    return focusNow.register({ focus, root }, groupId)
}

/**
 * Puts keyboard focus in an editor now (Focus Editor, F6): the one in `pane` when given, else the focused group's.
 * False when there is no editor there, or it is hidden or shows no file.
 */
export function focusEditorNow(pane?: Element): boolean {
    const entries = focusNow.all()
    if (pane && entries.some((entry) => entry.root() !== null)) {
        const inPane = entries.find((entry) => {
            const root = entry.root()
            return root !== null && (root === pane || pane.contains(root))
        })
        return inPane?.focus() ?? false
    }
    return focusNow.forFocused()?.focus() ?? false
}
