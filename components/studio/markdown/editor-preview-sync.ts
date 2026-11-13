import { matchScroll, scrollPairs, type ScrollPair, type ScrollPane } from '@/components/studio/markdown/scroll-map'

/** A preview block: the document line it starts on, and how far down the preview's content it starts, in pixels. */
export type SourceBlock = { line: number; top: number }

/** What the user does to work in a pane (scroll, click, type), which gives that pane the lead. */
export const USER_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/** What the sync needs from the code editor. */
export type EditorSide = {
    /** The tab the editor shows, or null with no file open. */
    tabId: () => string | null
    /** False while the user has scrolling with the preview switched off in Settings. */
    scrollEnabled: () => boolean
    /** False while the user has double-click to jump switched off in Settings. */
    jumpEnabled: () => boolean
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
    /**
     * The preview's content moved (new text, a diagram drawn). If the editor leads and has scrolled since it took
     * the lead, the preview lines up again.
     */
    previewChanged: () => void
    /** Moves the editor to a line the user double-clicked in the preview. False when that is switched off, or the panes show different documents. */
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

type Panes = { editor: EditorSide; preview: PreviewSide }

/**
 * Keeps the editor and the Markdown preview showing the same part of a document. The pane the user last worked in
 * leads; the other follows it, at most once a frame. The follower's own scroll events are ignored, so the two can't
 * push each other back and forth.
 */
export function createEditorPreviewSync(frames: FrameScheduler = browserFrames): EditorPreviewSync {
    let editor: EditorSide | null = null
    let preview: PreviewSide | null = null
    let leader: ScrollPane = 'editor'
    /**
     * Whether the editor has scrolled since it took the lead. Until it has, new preview content leaves the preview
     * where the user put it: a click or a key in an editor that hasn't moved says nothing about where to look.
     */
    let editorScrolled = false
    let frame: number | null = null
    /** True while the editor moves to a line the preview asked for, which mustn't hand the lead to the editor. */
    let jumping = false
    /**
     * The places the panes line up at, measured once and reused while scrolling. Measured again when the preview's
     * content changes, or the tab or either pane's scroll range does (as on a resize).
     */
    let measured: { key: string; pairs: ScrollPair[] } | null = null

    /** Both panes, when they show the same document. */
    function sameDocument(): Panes | null {
        if (!editor || !preview) return null
        const tabId = editor.tabId()
        return tabId !== null && tabId === preview.tabId() ? { editor, preview } : null
    }

    function linked(): Panes | null {
        const panes = sameDocument()
        return panes?.editor.scrollEnabled() ? panes : null
    }

    function pairsFor(panes: Panes): ScrollPair[] {
        const end = { editor: panes.editor.maxScrollTop(), preview: panes.preview.maxScrollTop() }
        const key = `${panes.editor.tabId()}|${end.editor}|${end.preview}`
        if (measured?.key !== key) {
            const points = panes.preview.blocks().map((block) => ({ editor: panes.editor.topForLine(block.line), preview: block.top }))
            measured = { key, pairs: scrollPairs(points, end) }
        }
        return measured.pairs
    }

    function moveTo(side: EditorSide | PreviewSide, top: number) {
        if (Math.abs(side.scrollTop() - top) >= 1) side.setScrollTop(top)
    }

    function follow() {
        frame = null
        const panes = linked()
        if (!panes) return
        const pairs = pairsFor(panes)
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
            measured = null
            return () => {
                if (editor !== side) return
                editor = null
                cancel()
            }
        },
        registerPreview(side) {
            preview = side
            measured = null
            return () => {
                if (preview !== side) return
                preview = null
                cancel()
            }
        },
        touched(pane) {
            if (jumping || pane === leader) return
            leader = pane
            editorScrolled = false
        },
        scrolled(pane) {
            if (pane !== leader) return
            if (pane === 'editor') editorScrolled = true
            schedule()
        },
        previewChanged() {
            measured = null
            if (leader === 'editor' && editorScrolled) schedule()
        },
        jumpToLine(line) {
            const panes = sameDocument()
            if (!panes?.editor.jumpEnabled()) return false
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
