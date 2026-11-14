/**
 * Monaco keeps one text model (buffer + undo history) per URI for the whole session.
 * Scrivon gives every open tab its own model URI, its "model key", instead of using the
 * file path:
 * - A tab that is closed and opened again gets a new key, so the editor starts from the
 *   file's current text, never from a leftover buffer.
 * - A tab that is renamed or moved keeps its key, so its buffer, undo history and cursor survive.
 */

export const MODEL_KEY_PREFIX = 'inmemory://scrivon/document-'

export type ModelKeyState = {
    /** Tab paths, in tab order, that `keys` was built for. */
    paths: readonly string[]
    /** Tab path -> model key. */
    keys: ReadonlyMap<string, string>
}

export const EMPTY_MODEL_KEYS: ModelKeyState = { paths: [], keys: new Map() }

let lastModelId = 0

/** A model key no earlier tab has used in this session. */
export function createModelKey(): string {
    lastModelId += 1
    return `${MODEL_KEY_PREFIX}${lastModelId}`
}

export function isModelKey(uri: string): boolean {
    return uri.startsWith(MODEL_KEY_PREFIX)
}

export function samePaths(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((path, i) => path === b[i])
}

function splitPath(path: string): string[] {
    return path.split(/[/\\]/)
}

function sameSegments(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((segment, i) => segment === b[i])
}

function startsWith(segments: readonly string[], root: readonly string[]): boolean {
    return segments.length >= root.length && root.every((segment, i) => segment === segments[i])
}

/**
 * Finds tabs that were renamed or moved, as remapTabsAfterRename does: the tab list keeps its length
 * and order, and the changed paths are all inside one file or folder that moved from `oldRoot` to
 * `newRoot`, keeping the rest of their path. No tab is left inside `oldRoot`. Returns new path -> old
 * path. Anything else (tabs opened, closed or replaced) returns an empty map.
 */
export function detectRenamedPaths(prev: readonly string[], next: readonly string[]): Map<string, string> {
    const renamed = new Map<string, string>()
    if (prev.length !== next.length) return renamed

    const prevSet = new Set(prev)
    const nextSet = new Set(next)
    const changed: { from: string[]; to: string[] }[] = []
    for (let i = 0; i < prev.length; i++) {
        const oldPath = prev[i]!
        const newPath = next[i]!
        if (oldPath === newPath) continue
        if (nextSet.has(oldPath) || prevSet.has(newPath)) return new Map()
        changed.push({ from: splitPath(oldPath), to: splitPath(newPath) })
        renamed.set(newPath, oldPath)
    }
    if (changed.length === 0) return renamed

    const nextSegments = next.map(splitPath)
    const isOneMove = (oldRoot: string[], newRoot: string[]) =>
        changed.every(
            ({ from, to }) =>
                startsWith(from, oldRoot) && startsWith(to, newRoot) && sameSegments(from.slice(oldRoot.length), to.slice(newRoot.length))
        ) &&
        // Every tab inside the moved file or folder went with it.
        !nextSegments.some((segments) => startsWith(segments, oldRoot))

    // The moved entry is the first changed tab's file or one of the folders above it, so try each.
    const { from, to } = changed[0]!
    for (let rest = 0; rest < Math.min(from.length, to.length); rest++) {
        if (isOneMove(from.slice(0, from.length - rest), to.slice(0, to.length - rest))) return renamed
    }
    return new Map()
}

/**
 * Works out the model key of every open tab after the tab list changed: tabs that stayed
 * open or were renamed or moved keep their key, and newly opened tabs get a new one.
 */
export function syncModelKeys(prev: ModelKeyState, nextPaths: readonly string[], newKey: () => string = createModelKey): ModelKeyState {
    if (samePaths(prev.paths, nextPaths)) return prev

    const renamed = detectRenamedPaths(prev.paths, nextPaths)
    const keys = new Map<string, string>()
    for (const path of nextPaths) {
        if (keys.has(path)) continue
        const oldPath = renamed.get(path)
        keys.set(path, prev.keys.get(path) ?? (oldPath !== undefined ? prev.keys.get(oldPath) : undefined) ?? newKey())
    }
    return { paths: [...nextPaths], keys }
}

/** Monaco normalises line endings and drops a leading BOM, so compare text the same way. */
export function normalizeEditorText(text: string): string {
    return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}
