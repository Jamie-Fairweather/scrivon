import { useSyncExternalStore } from 'react'
import type { editor } from 'monaco-editor'

/**
 * Where the caret is in the code editor and what is selected, for the status bar. The editor panel
 * reports it (trackEditorCursor), and only what reads it draws again as the caret moves.
 */
export type EditorCursor = {
    /** 1-based, as shown to the user. */
    line: number
    column: number
    /** The selected text (several selections joined by line breaks), or '' when nothing is selected. */
    selectedText: string
}

export type CursorSource = Pick<
    editor.IStandaloneCodeEditor,
    'getModel' | 'getPosition' | 'getSelections' | 'onDidChangeCursorSelection' | 'onDidChangeModel' | 'onDidChangeModelContent' | 'onDidDispose'
>

let current: EditorCursor | null = null
let owner: CursorSource | null = null
const listeners = new Set<() => void>()

function publish(next: EditorCursor | null) {
    const same =
        next === current ||
        (next !== null &&
            current !== null &&
            next.line === current.line &&
            next.column === current.column &&
            next.selectedText === current.selectedText)
    if (same) return
    current = next
    for (const listener of listeners) listener()
}

function readCursor(source: CursorSource): EditorCursor | null {
    const model = source.getModel()
    const position = source.getPosition()
    if (!model || !position) return null
    const selectedText = (source.getSelections() ?? [])
        .filter((selection) => !selection.isEmpty())
        .map((selection) => model.getValueInRange(selection))
        .join('\n')
    return { line: position.lineNumber, column: position.column, selectedText }
}

/** Reports the editor's caret and selection from now on. Returns the function that stops it. */
export function trackEditorCursor(source: CursorSource): () => void {
    owner = source
    const update = () => {
        if (owner === source) publish(readCursor(source))
    }
    const subscriptions = [
        source.onDidChangeCursorSelection(update),
        source.onDidChangeModel(update),
        // Text replaced under a selection (a reload from disk) changes what is selected without moving it.
        source.onDidChangeModelContent(update),
    ]
    const stop = () => {
        for (const subscription of subscriptions) subscription.dispose()
        subscriptions.length = 0
        if (owner !== source) return
        owner = null
        publish(null)
    }
    subscriptions.push(source.onDidDispose(stop))
    update()
    return stop
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const getCursor = () => current
const getServerCursor = () => null

/** The code editor's caret and selection, or null when no editor is showing a file. */
export function useEditorCursor(): EditorCursor | null {
    return useSyncExternalStore(subscribe, getCursor, getServerCursor)
}
