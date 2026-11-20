import type { IDisposable, editor } from 'monaco-editor'
import { dimmedLineSpans, focusedLines } from '@/lib/monaco/paragraph-dimming'

/**
 * Fades the text it is on (app/globals.css). Only the letters: the selection, find highlights and spelling
 * squiggles are drawn in layers of their own, so they stay as they are.
 */
export const DIMMED_TEXT_CLASS = 'editor-dimmed-text'

/** Monaco's TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges: text typed next to a faded line isn't faded. */
const NEVER_GROWS = 1

export type ParagraphDimming = IDisposable & {
    /** Works out the faded lines again, as after switching the setting. */
    refresh: () => void
}

/**
 * Dim Other Paragraphs: fades every line but the paragraphs the cursors and selections are in, with at most two
 * decorations (the lines above and the lines below). They follow the cursor and the text, once a frame at most.
 */
export function bindParagraphDimming(codeEditor: editor.ICodeEditor, enabled: () => boolean): ParagraphDimming {
    const decorations = codeEditor.createDecorationsCollection()
    let frame: number | null = null

    const update = () => {
        frame = null
        const model = codeEditor.getModel()
        const selections = codeEditor.getSelections()
        if (!enabled() || !model || !selections) {
            decorations.clear()
            return
        }
        const lineCount = model.getLineCount()
        const focused = focusedLines(lineCount, (line) => model.getLineContent(line), selections)
        decorations.set(
            dimmedLineSpans(lineCount, focused).map(({ start, end }) => ({
                range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: model.getLineMaxColumn(end) },
                options: { description: 'dim-other-paragraphs', inlineClassName: DIMMED_TEXT_CLASS, stickiness: NEVER_GROWS },
            }))
        )
    }

    const schedule = () => {
        if (frame === null) frame = requestAnimationFrame(update)
    }

    const listeners = [
        codeEditor.onDidChangeCursorSelection(schedule),
        codeEditor.onDidChangeModelContent(schedule),
        codeEditor.onDidChangeModel(schedule),
    ]
    update()

    return {
        refresh: schedule,
        dispose: () => {
            if (frame !== null) cancelAnimationFrame(frame)
            frame = null
            for (const listener of listeners) listener.dispose()
            decorations.clear()
        },
    }
}
