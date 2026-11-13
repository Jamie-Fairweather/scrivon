import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorPreviewSync, type EditorSide, type EditorPreviewSync, type PreviewSide } from './editor-preview-sync'

/** Frames that run only when the test says so. */
function manualFrames() {
    let next = 1
    const pending = new Map<number, () => void>()
    return {
        request: (run: () => void) => {
            const id = next++
            pending.set(id, run)
            return id
        },
        cancel: (id: number) => {
            pending.delete(id)
        },
        run() {
            const runs = [...pending.values()]
            pending.clear()
            runs.forEach((run) => run())
        },
        get count() {
            return pending.size
        },
    }
}

/**
 * An editor of 100 lines, 20px each (line 1 at the top), that can scroll 1600px; and a preview of blocks on lines
 * 1, 11, 21 … 91 at 0, 400, 800 … 3600 that can scroll 3200px. So the editor at 200 (line 11) matches the preview
 * at 400. Like Monaco, the editor scrolls only to whole pixels.
 */
function fakeEditor(overrides: Partial<EditorSide> = {}) {
    const state = { top: 0, max: 1600, tab: 'a.md' as string | null, scroll: true, jump: true }
    const side: EditorSide = {
        tabId: () => state.tab,
        scrollEnabled: () => state.scroll,
        jumpEnabled: () => state.jump,
        scrollTop: () => state.top,
        maxScrollTop: () => state.max,
        setScrollTop: vi.fn((top: number) => {
            state.top = Math.floor(top)
        }),
        topForLine: (line) => (line - 1) * 20,
        revealLine: vi.fn(),
        ...overrides,
    }
    return { state, side }
}

/** `shift` moves every block down, as a diagram drawn at the top of the document would. */
function fakePreview() {
    const state = { top: 0, max: 3200, shift: 0, tab: 'a.md' as string | null }
    const side: PreviewSide = {
        tabId: () => state.tab,
        scrollTop: () => state.top,
        maxScrollTop: () => state.max,
        setScrollTop: vi.fn((top: number) => {
            state.top = top
        }),
        blocks: vi.fn(() => Array.from({ length: 10 }, (_, index) => ({ line: index * 10 + 1, top: index * 400 + state.shift }))),
    }
    return { state, side }
}

describe('createEditorPreviewSync', () => {
    let frames: ReturnType<typeof manualFrames>
    let sync: EditorPreviewSync
    let editor: ReturnType<typeof fakeEditor>
    let preview: ReturnType<typeof fakePreview>

    beforeEach(() => {
        frames = manualFrames()
        sync = createEditorPreviewSync(frames)
        editor = fakeEditor()
        preview = fakePreview()
        sync.registerEditor(editor.side)
        sync.registerPreview(preview.side)
    })

    /** The user scrolls the editor to `top`, and the preview follows. */
    function scrollEditor(top: number) {
        sync.touched('editor')
        editor.state.top = top
        sync.scrolled('editor')
        frames.run()
    }

    /** The user scrolls the preview to `top`, and the editor follows. */
    function scrollPreview(top: number) {
        sync.touched('preview')
        preview.state.top = top
        sync.scrolled('preview')
        frames.run()
    }

    it('moves the preview to the same part of the document when the editor scrolls', () => {
        editor.state.top = 300
        sync.scrolled('editor')
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()

        frames.run()
        expect(preview.state.top).toBe(600)
    })

    it('moves the editor when the user scrolls the preview', () => {
        scrollPreview(1000)
        expect(editor.state.top).toBe(500)
    })

    it('never lets the pane that follows move the one that leads back', () => {
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        // The preview's own scroll event, from being moved.
        sync.scrolled('preview')
        frames.run()
        expect(editor.side.setScrollTop).not.toHaveBeenCalled()

        scrollPreview(1000)
        sync.scrolled('editor')
        frames.run()
        expect(preview.side.setScrollTop).toHaveBeenCalledTimes(1)
    })

    it('moves the other pane once a frame, however many scroll events come in it', () => {
        for (const top of [100, 200, 300]) {
            editor.state.top = top
            sync.scrolled('editor')
        }
        expect(frames.count).toBe(1)
        frames.run()
        expect(preview.side.setScrollTop).toHaveBeenCalledTimes(1)
        expect(preview.state.top).toBe(600)
    })

    it('leaves a pane alone when it is already in place', () => {
        preview.state.top = 600.4
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
    })

    it('lines the preview up again when its content changes while the editor leads', () => {
        scrollEditor(300)
        expect(preview.state.top).toBe(600)

        // A diagram drawn at the top pushes everything down by 100px.
        preview.state.shift = 100
        sync.previewChanged()
        frames.run()
        expect(preview.state.top).toBe(700)
    })

    it('leaves the preview where the user put it when its content changes', () => {
        scrollPreview(1000)
        vi.mocked(editor.side.setScrollTop).mockClear()
        sync.previewChanged()
        frames.run()
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
        expect(editor.side.setScrollTop).not.toHaveBeenCalled()
    })

    describe('a click or key in the editor that does not scroll it', () => {
        it('leaves the preview where it is, when the whole file fits in the editor', () => {
            const short = fakeEditor()
            short.state.max = 0
            sync.registerEditor(short.side)
            scrollPreview(1200)

            // The user clicks in the editor and types, and the preview redraws.
            sync.touched('editor')
            sync.previewChanged()
            frames.run()
            expect(preview.state.top).toBe(1200)
            expect(preview.side.setScrollTop).not.toHaveBeenCalled()
        })

        it('leaves the preview where it is, though the editor could only follow it to a whole pixel', () => {
            scrollPreview(1001)
            // 500.5, rounded down.
            expect(editor.state.top).toBe(500)

            sync.touched('editor')
            sync.previewChanged()
            frames.run()
            expect(preview.state.top).toBe(1001)

            // Once the editor scrolls, the preview follows it again.
            editor.state.top = 520
            sync.scrolled('editor')
            frames.run()
            expect(preview.state.top).toBe(1040)
        })
    })

    it('measures the blocks once while scrolling, and again when the preview’s content changes', () => {
        for (const top of [100, 200, 300]) scrollEditor(top)
        expect(preview.state.top).toBe(600)
        expect(preview.side.blocks).toHaveBeenCalledTimes(1)

        sync.previewChanged()
        frames.run()
        expect(preview.side.blocks).toHaveBeenCalledTimes(2)
        scrollEditor(400)
        expect(preview.side.blocks).toHaveBeenCalledTimes(2)
    })

    it('measures the blocks again when a pane is resized or the tab changes', () => {
        scrollEditor(300)
        expect(preview.side.blocks).toHaveBeenCalledTimes(1)

        preview.state.max = 3000
        scrollEditor(310)
        expect(preview.side.blocks).toHaveBeenCalledTimes(2)

        editor.state.max = 1500
        scrollEditor(320)
        expect(preview.side.blocks).toHaveBeenCalledTimes(3)

        editor.state.tab = 'b.md'
        preview.state.tab = 'b.md'
        scrollEditor(330)
        expect(preview.side.blocks).toHaveBeenCalledTimes(4)
    })

    it('does not scroll the panes together while that is switched off, but still jumps', () => {
        editor.state.scroll = false
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()

        expect(sync.jumpToLine(11)).toBe(true)
        expect(editor.side.revealLine).toHaveBeenCalledWith(11)
    })

    it('does not jump while double-click is switched off, but still scrolls the panes together', () => {
        editor.state.jump = false
        expect(sync.jumpToLine(11)).toBe(false)
        expect(editor.side.revealLine).not.toHaveBeenCalled()

        scrollEditor(300)
        expect(preview.state.top).toBe(600)
    })

    it('does nothing while the panes show different documents, or no document', () => {
        preview.state.tab = 'b.md'
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        expect(sync.jumpToLine(11)).toBe(false)

        preview.state.tab = null
        editor.state.tab = null
        sync.scrolled('editor')
        frames.run()
        expect(sync.jumpToLine(11)).toBe(false)
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
        expect(editor.side.revealLine).not.toHaveBeenCalled()
    })

    it('does nothing without both panes', () => {
        const lonely = createEditorPreviewSync(frames)
        const unregister = lonely.registerEditor(editor.side)
        lonely.scrolled('editor')
        frames.run()
        expect(lonely.jumpToLine(11)).toBe(false)
        unregister()
        lonely.registerPreview(preview.side)
        lonely.touched('preview')
        lonely.scrolled('preview')
        frames.run()
        expect(editor.side.setScrollTop).not.toHaveBeenCalled()
    })

    it('drops a pending move when a pane goes away', () => {
        const other = createEditorPreviewSync(frames)
        const otherPreview = fakePreview()
        const unregisterPreview = other.registerPreview(otherPreview.side)
        other.registerEditor(editor.side)
        editor.state.top = 300
        other.scrolled('editor')
        unregisterPreview()
        expect(frames.count).toBe(0)
        frames.run()
        expect(otherPreview.side.setScrollTop).not.toHaveBeenCalled()
    })

    it('keeps a newer pane when an older one goes away', () => {
        const newer = fakePreview()
        const unregisterOlder = sync.registerPreview(fakePreview().side)
        sync.registerPreview(newer.side)
        unregisterOlder()
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        expect(newer.state.top).toBe(600)
    })

    describe('jumpToLine', () => {
        it('moves the editor to the line', () => {
            expect(sync.jumpToLine(21)).toBe(true)
            expect(editor.side.revealLine).toHaveBeenCalledWith(21)
        })

        it('keeps the preview still: moving the cursor there does not hand the lead to the editor', () => {
            const revealing = fakeEditor({
                revealLine: vi.fn(() => {
                    // What the editor tells the sync while it moves its cursor and scrolls (centring the line).
                    sync.touched('editor')
                    revealing.state.top = 330
                    sync.scrolled('editor')
                }),
            })
            sync.registerEditor(revealing.side)
            sync.touched('preview')

            sync.jumpToLine(21)
            frames.run()
            expect(preview.side.setScrollTop).not.toHaveBeenCalled()

            // Typing there hands the editor the lead, but the preview stays put until the editor scrolls.
            sync.touched('editor')
            sync.previewChanged()
            frames.run()
            expect(preview.side.setScrollTop).not.toHaveBeenCalled()

            revealing.state.top = 400
            sync.scrolled('editor')
            frames.run()
            expect(preview.state.top).toBe(800)
        })
    })
})
