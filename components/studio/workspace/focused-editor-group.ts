/**
 * Which editor group has the keyboard, by group id, for the few app-wide helpers that reach an editor or a preview
 * outside React (editor-focus.ts, preview-heading.ts, the editor models). DocumentTabsProvider sets it as soon as the
 * focused group changes, before the screen draws again, so a helper called straight after a switch finds the right one.
 */

let focusedId: string | null = null

export function setFocusedEditorGroupId(id: string | null): void {
    focusedId = id
}

export function focusedEditorGroupId(): string | null {
    return focusedId
}

/**
 * Something each group registers (its editor, its preview), most recent last. `forFocused` picks the focused
 * group's, else the one registered last, as with a single group before the split.
 */
export function createGroupRegistry<T>() {
    const entries: Array<{ groupId: string | null; value: T }> = []
    return {
        register(value: T, groupId: string | null = null): () => void {
            const entry = { groupId, value }
            entries.push(entry)
            return () => {
                const index = entries.indexOf(entry)
                if (index !== -1) entries.splice(index, 1)
            }
        },
        forFocused(): T | undefined {
            const id = focusedId
            const focused = id === null ? undefined : entries.findLast((entry) => entry.groupId === id)
            return (focused ?? entries.at(-1))?.value
        },
        all(): T[] {
            return entries.map((entry) => entry.value)
        },
    }
}
