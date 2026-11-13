import type { IDisposable, editor } from 'monaco-editor'
import { editorPreviewSync, type EditorPreviewSync } from '@/components/studio/markdown/editor-preview-sync'

/** The parts of a Monaco editor the sync uses. */
export type ScrollableEditor = Pick<
    editor.ICodeEditor,
    | 'getScrollTop'
    | 'setScrollTop'
    | 'getScrollHeight'
    | 'getLayoutInfo'
    | 'getTopForLineNumber'
    | 'getModel'
    | 'setPosition'
    | 'revealLineInCenterIfOutsideViewport'
    | 'focus'
    | 'getDomNode'
    | 'onDidScrollChange'
    | 'onDidChangeCursorPosition'
>

export type EditorScrollSyncOptions = {
    /** The tab the editor shows. */
    tabId: () => string | null
    /** Whether the user has the link to the preview switched on. */
    enabled: () => boolean
    /** False while the editor is hidden, so a jump doesn't try to focus it. */
    canFocus: () => boolean
}

/** What the user does to work in the editor without moving the cursor, which makes the preview follow it. */
const USER_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/** Links the editor to the Markdown preview (see createEditorPreviewSync). Dispose of it with the editor. */
export function bindEditorScrollSync(
    codeEditor: ScrollableEditor,
    options: EditorScrollSyncOptions,
    sync: EditorPreviewSync = editorPreviewSync
): IDisposable {
    const lineInDocument = (line: number) => Math.min(Math.max(1, line), codeEditor.getModel()?.getLineCount() ?? 1)

    const unregister = sync.registerEditor({
        tabId: options.tabId,
        enabled: options.enabled,
        scrollTop: () => codeEditor.getScrollTop(),
        maxScrollTop: () => Math.max(0, codeEditor.getScrollHeight() - codeEditor.getLayoutInfo().height),
        setScrollTop: (top) => codeEditor.setScrollTop(top),
        topForLine: (line) => codeEditor.getTopForLineNumber(lineInDocument(line)),
        revealLine: (line) => {
            const lineNumber = lineInDocument(line)
            codeEditor.setPosition({ lineNumber, column: 1 })
            codeEditor.revealLineInCenterIfOutsideViewport(lineNumber)
            if (options.canFocus()) codeEditor.focus()
        },
    })
    const onUserEvent = () => sync.touched('editor')
    const scrolled = codeEditor.onDidScrollChange((event) => {
        if (event.scrollTopChanged) sync.scrolled('editor')
    })
    // Typing, clicking, and jumps from elsewhere (the palette) all move the cursor.
    const cursorMoved = codeEditor.onDidChangeCursorPosition(onUserEvent)
    const node = codeEditor.getDomNode()
    for (const type of USER_EVENTS) node?.addEventListener(type, onUserEvent, { capture: true, passive: true })

    return {
        dispose() {
            unregister()
            scrolled.dispose()
            cursorMoved.dispose()
            for (const type of USER_EVENTS) node?.removeEventListener(type, onUserEvent, { capture: true })
        },
    }
}
