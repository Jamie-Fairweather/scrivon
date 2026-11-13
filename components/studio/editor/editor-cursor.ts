'use client'

import { useSyncExternalStore } from 'react'

/**
 * The line the editor's cursor is on, in the file it shows (null with no editor). The editor panel sets it; the
 * Outline panel reads it to mark the heading you're in.
 */
let cursorLine: number | null = null
const listeners = new Set<() => void>()

export function setEditorCursorLine(line: number | null): void {
    if (line === cursorLine) return
    cursorLine = line
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const getCursorLine = () => cursorLine
const getServerCursorLine = () => null

export function useEditorCursorLine(): number | null {
    return useSyncExternalStore(subscribe, getCursorLine, getServerCursorLine)
}
