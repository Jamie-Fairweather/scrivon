import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EditorPreviewSync, EditorSide } from '@/components/studio/markdown/editor-preview-sync'
import { bindEditorScrollSync, type ScrollableEditor } from './editor-scroll-sync'

type Listener<T> = (event: T) => void

/** Just enough of a Monaco editor: 50 lines of 19px, a 300px tall view, and the events the sync listens to. */
function fakeEditor() {
    const scrollListeners = new Set<Listener<{ scrollTopChanged: boolean }>>()
    const cursorListeners = new Set<Listener<unknown>>()
    const node = document.createElement('div')
    document.body.append(node)
    let scrollTop = 0
    const editor = {
        node,
        getScrollTop: () => scrollTop,
        setScrollTop: vi.fn((top: number) => {
            scrollTop = top
        }),
        getScrollHeight: () => 50 * 19,
        getLayoutInfo: () => ({ height: 300 }),
        getTopForLineNumber: vi.fn((line: number) => (line - 1) * 19),
        getModel: () => ({ getLineCount: () => 50 }),
        setPosition: vi.fn(),
        revealLineInCenterIfOutsideViewport: vi.fn(),
        focus: vi.fn(),
        getDomNode: () => node,
        onDidScrollChange: (listener: Listener<{ scrollTopChanged: boolean }>) => {
            scrollListeners.add(listener)
            return { dispose: () => scrollListeners.delete(listener) }
        },
        onDidChangeCursorPosition: (listener: Listener<unknown>) => {
            cursorListeners.add(listener)
            return { dispose: () => cursorListeners.delete(listener) }
        },
        scroll: (scrollTopChanged = true) => scrollListeners.forEach((listener) => listener({ scrollTopChanged })),
        moveCursor: () => cursorListeners.forEach((listener) => listener({})),
    }
    return editor
}

function fakeSync() {
    let side: EditorSide | null = null
    const unregister = vi.fn()
    const sync: EditorPreviewSync = {
        registerEditor: vi.fn((given: EditorSide) => {
            side = given
            return unregister
        }),
        registerPreview: vi.fn(() => () => {}),
        touched: vi.fn(),
        scrolled: vi.fn(),
        previewChanged: vi.fn(),
        jumpToLine: vi.fn(() => true),
    }
    return { sync, unregister, side: () => side! }
}

function bind(options: { tabId?: string | null; enabled?: boolean; canFocus?: boolean } = {}) {
    const editor = fakeEditor()
    const fake = fakeSync()
    const binding = bindEditorScrollSync(
        editor as unknown as ScrollableEditor,
        {
            tabId: () => options.tabId ?? 'a.md',
            enabled: () => options.enabled ?? true,
            canFocus: () => options.canFocus ?? true,
        },
        fake.sync
    )
    return { editor, binding, ...fake }
}

describe('bindEditorScrollSync', () => {
    it('gives the sync the editor’s tab, the setting, and how far it is and can be scrolled', () => {
        const { side, editor } = bind({ tabId: 'notes.md', enabled: false })
        expect(side().tabId()).toBe('notes.md')
        expect(side().enabled()).toBe(false)
        expect(side().maxScrollTop()).toBe(50 * 19 - 300)
        side().setScrollTop(120)
        expect(editor.setScrollTop).toHaveBeenCalledWith(120)
        expect(side().scrollTop()).toBe(120)
    })

    it('finds where a line is, keeping the line inside the document', () => {
        const { side } = bind()
        expect(side().topForLine(11)).toBe(190)
        expect(side().topForLine(0)).toBe(0)
        expect(side().topForLine(80)).toBe(49 * 19)
    })

    it('jumps to a line: cursor at its start, shown, and focus in the editor', () => {
        const { side, editor } = bind()
        side().revealLine(12)
        expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 12, column: 1 })
        expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(12)
        expect(editor.focus).toHaveBeenCalled()
    })

    it('leaves focus where it is while the editor is hidden', () => {
        const { side, editor } = bind({ canFocus: false })
        side().revealLine(12)
        expect(editor.setPosition).toHaveBeenCalled()
        expect(editor.focus).not.toHaveBeenCalled()
    })

    it('says when the editor scrolls down or up, but not sideways', () => {
        const { sync, editor } = bind()
        editor.scroll(false)
        expect(sync.scrolled).not.toHaveBeenCalled()
        editor.scroll()
        expect(sync.scrolled).toHaveBeenCalledWith('editor')
    })

    it('says when the user works in the editor: moving the cursor, scrolling, clicking or typing', () => {
        const { sync, editor } = bind()
        editor.moveCursor()
        expect(sync.touched).toHaveBeenCalledWith('editor')
        for (const fire of [fireEvent.wheel, fireEvent.pointerDown, fireEvent.keyDown, fireEvent.touchStart]) {
            vi.mocked(sync.touched).mockClear()
            fire(editor.node)
            expect(sync.touched).toHaveBeenCalledWith('editor')
        }
    })

    it('lets go of the editor when disposed', () => {
        const { sync, editor, binding, unregister } = bind()
        binding.dispose()
        expect(unregister).toHaveBeenCalled()
        editor.scroll()
        editor.moveCursor()
        fireEvent.wheel(editor.node)
        expect(sync.scrolled).not.toHaveBeenCalled()
        expect(sync.touched).not.toHaveBeenCalled()
    })
})
