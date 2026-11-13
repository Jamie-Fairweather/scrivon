import { matchScroll, scrollPairs, type ScrollPane } from '@/components/studio/markdown/scroll-map'

/** A preview block: the document line it starts on, and how far down the preview's content it starts, in pixels. */
export type SourceBlock = { line: number; top: number }

/** What the sync needs from the code editor. */
export type EditorSide = {
    /** The tab the editor shows, or null with no file open. */
    tabId: () => string | null
    /** False while the user has the link switched off in Settings. */
    enabled: () => boolean
    scrollTop: () => number
    maxScrollTop: () => number
    setScrollTop: (top: number) => void
    /** How far to scroll the editor to show `line` (from 1) at its top. */
    topForLine: (line: number) => number
    /** Puts the cursor at the start of `line`, scrolls to it if needed, and focuses the editor if it can. */
    revealLine: (line: number) => void
}

/** What the sync needs from the Markdown preview. */
export type PreviewSide = {
    tabId: () => string | null
    scrollTop: () => number
    maxScrollTop: () => number
    setScrollTop: (top: number) => void
    blocks: () => SourceBlock[]
}

export type EditorPreviewSync = {
    /** Each returns the function that removes the pane again. */
    registerEditor: (side: EditorSide) => () => void
    registerPreview: (side: PreviewSide) => () => void
    /** The user is working in this pane (scrolling, clicking, typing), so it leads and the other follows. */
    touched: (pane: ScrollPane) => void
    /** The pane scrolled. If it leads, the other follows on the next frame. */
    scrolled: (pane: ScrollPane) => void
    /** The preview's content moved (new text, a diagram drawn). If the editor leads, the preview lines up again. */
    previewChanged: () => void
    /** Moves the editor to a line the user double-clicked in the preview. False when the panes aren't linked. */
    jumpToLine: (line: number) => boolean
}

export type FrameScheduler = {
    request: (run: () => void) => number
    cancel: (id: number) => void
}

const browserFrames: FrameScheduler = {
    request: (run) => requestAnimationFrame(run),
    cancel: (id) => cancelAnimationFrame(id),
}

/**
 * Keeps the editor and the Markdown preview showing the same part of a document. The pane the user last worked in
 * leads; the other follows it, at most once a frame. The follower's own scroll events are ignored, so the two can't
 * push each other back and forth.
 */
export function createEditorPreviewSync(frames: FrameScheduler = browserFrames): EditorPreviewSync {
    let editor: EditorSide | null = null
    let preview: PreviewSide | null = null
    let leader: ScrollPane = 'editor'
    let frame: number | null = null
    /** True while the editor moves to a line the preview asked for, which mustn't hand the lead to the editor. */
    let jumping = false

    function linked(): { editor: EditorSide; preview: PreviewSide } | null {
        if (!editor || !preview || !editor.enabled()) return null
        const tabId = editor.tabId()
        return tabId !== null && tabId === preview.tabId() ? { editor, preview } : null
    }

    function moveTo(side: EditorSide | PreviewSide, top: number) {
        if (Math.abs(side.scrollTop() - top) >= 1) side.setScrollTop(top)
    }

    function follow() {
        frame = null
        const panes = linked()
        if (!panes) return
        const points = panes.preview.blocks().map((block) => ({ editor: panes.editor.topForLine(block.line), preview: block.top }))
        const pairs = scrollPairs(points, { editor: panes.editor.maxScrollTop(), preview: panes.preview.maxScrollTop() })
        if (leader === 'editor') moveTo(panes.preview, matchScroll(pairs, 'editor', panes.editor.scrollTop()))
        else moveTo(panes.editor, matchScroll(pairs, 'preview', panes.preview.scrollTop()))
    }

    function schedule() {
        if (frame === null && linked()) frame = frames.request(follow)
    }

    function cancel() {
        if (frame !== null) frames.cancel(frame)
        frame = null
    }

    return {
        registerEditor(side) {
            editor = side
            return () => {
                if (editor !== side) return
                editor = null
                cancel()
            }
        },
        registerPreview(side) {
            preview = side
            return () => {
                if (preview !== side) return
                preview = null
                cancel()
            }
        },
        touched(pane) {
            if (!jumping) leader = pane
        },
        scrolled(pane) {
            if (pane === leader) schedule()
        },
        previewChanged() {
            if (leader === 'editor') schedule()
        },
        jumpToLine(line) {
            const panes = linked()
            if (!panes) return false
            jumping = true
            try {
                panes.editor.revealLine(line)
            } finally {
                jumping = false
            }
            return true
        },
    }
}

/** The one the editor panel and the Markdown preview share. */
export const editorPreviewSync = createEditorPreviewSync()
