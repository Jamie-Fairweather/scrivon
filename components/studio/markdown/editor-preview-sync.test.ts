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
 * at 400.
 */
function fakeEditor(overrides: Partial<EditorSide> = {}) {
    const state = { top: 0, tab: 'a.md' as string | null, enabled: true }
    const side: EditorSide = {
        tabId: () => state.tab,
        enabled: () => state.enabled,
        scrollTop: () => state.top,
        maxScrollTop: () => 1600,
        setScrollTop: vi.fn((top: number) => {
            state.top = top
        }),
        topForLine: (line) => (line - 1) * 20,
        revealLine: vi.fn(),
        ...overrides,
    }
    return { state, side }
}

function fakePreview() {
    const state = { top: 0, tab: 'a.md' as string | null }
    const side: PreviewSide = {
        tabId: () => state.tab,
        scrollTop: () => state.top,
        maxScrollTop: () => 3200,
        setScrollTop: vi.fn((top: number) => {
            state.top = top
        }),
        blocks: vi.fn(() => Array.from({ length: 10 }, (_, index) => ({ line: index * 10 + 1, top: index * 400 }))),
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

    it('moves the preview to the same part of the document when the editor scrolls', () => {
        editor.state.top = 300
        sync.scrolled('editor')
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()

        frames.run()
        expect(preview.state.top).toBe(600)
    })

    it('moves the editor when the user scrolls the preview', () => {
        sync.touched('preview')
        preview.state.top = 1000
        sync.scrolled('preview')
        frames.run()
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

        sync.touched('preview')
        preview.state.top = 1000
        sync.scrolled('preview')
        frames.run()
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
        editor.state.top = 300
        sync.previewChanged()
        frames.run()
        expect(preview.state.top).toBe(600)
    })

    it('leaves the preview where the user put it when its content changes', () => {
        sync.touched('preview')
        preview.state.top = 1000
        sync.previewChanged()
        frames.run()
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
        expect(editor.side.setScrollTop).not.toHaveBeenCalled()
    })

    it('does nothing when the setting is off', () => {
        editor.state.enabled = false
        editor.state.top = 300
        sync.scrolled('editor')
        frames.run()
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
        expect(sync.jumpToLine(11)).toBe(false)
        expect(editor.side.revealLine).not.toHaveBeenCalled()
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
        expect(preview.side.setScrollTop).not.toHaveBeenCalled()
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
                    // What the editor tells the sync while it moves its cursor and scrolls.
                    sync.touched('editor')
                    revealing.state.top = 400
                    sync.scrolled('editor')
                }),
            })
            sync.registerEditor(revealing.side)
            sync.touched('preview')

            sync.jumpToLine(21)
            frames.run()
            expect(preview.side.setScrollTop).not.toHaveBeenCalled()

            // Typing in the editor afterwards hands it the lead again.
            sync.touched('editor')
            sync.scrolled('editor')
            frames.run()
            expect(preview.state.top).toBe(800)
        })
    })
})
