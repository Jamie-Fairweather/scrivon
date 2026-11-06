/**
 * Monaco keeps one text model (buffer + undo history) per URI for the whole session.
 * Scrivon gives every open tab its own model URI, its "model key", instead of using the
 * file path:
 * - A tab that is closed and opened again gets a new key, so the editor starts from the
 *   file's current text, never from a leftover buffer.
 * - A tab that is renamed keeps its key, so its buffer, undo history and cursor survive.
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

/**
 * Finds tabs that were renamed in place, as remapTabsAfterRename does: the tab list keeps
 * its length and order, and the changed paths all differ in one path segment (the renamed
 * file or folder) under the same parent. Returns new path -> old path. Anything else (tabs
 * opened, closed or replaced) returns an empty map.
 */
export function detectRenamedPaths(prev: readonly string[], next: readonly string[]): Map<string, string> {
    const renamed = new Map<string, string>()
    if (prev.length !== next.length) return renamed

    const prevSet = new Set(prev)
    const nextSet = new Set(next)
    let renamedIndex = -1
    let oldRoot: string[] | null = null
    let newRoot: string[] | null = null

    for (let i = 0; i < prev.length; i++) {
        const oldPath = prev[i]!
        const newPath = next[i]!
        if (oldPath === newPath) continue
        if (nextSet.has(oldPath) || prevSet.has(newPath)) return new Map()

        const oldSegments = splitPath(oldPath)
        const newSegments = splitPath(newPath)
        if (oldSegments.length !== newSegments.length) return new Map()

        if (!oldRoot || !newRoot) {
            const differing = oldSegments.flatMap((segment, index) => (segment === newSegments[index] ? [] : [index]))
            if (differing.length !== 1) return new Map()
            renamedIndex = differing[0]!
            oldRoot = oldSegments.slice(0, renamedIndex + 1)
            newRoot = newSegments.slice(0, renamedIndex + 1)
        }

        const matchesRename =
            oldSegments.length > renamedIndex &&
            sameSegments(oldSegments.slice(0, renamedIndex + 1), oldRoot) &&
            sameSegments(newSegments.slice(0, renamedIndex + 1), newRoot) &&
            sameSegments(oldSegments.slice(renamedIndex + 1), newSegments.slice(renamedIndex + 1))
        if (!matchesRename) return new Map()

        renamed.set(newPath, oldPath)
    }

    if (oldRoot) {
        // Every tab inside the renamed file or folder must have moved with it.
        const root = oldRoot
        const leftBehind = next.some((path) => {
            const segments = splitPath(path)
            return segments.length > renamedIndex && sameSegments(segments.slice(0, renamedIndex + 1), root)
        })
        if (leftBehind) return new Map()
    }

    return renamed
}

/**
 * Works out the model key of every open tab after the tab list changed: tabs that stayed
 * open or were renamed keep their key, and newly opened tabs get a new one.
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
    return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}
