import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runEditorAction, runInEditor } from '@/lib/monaco/editor-actions'

function fakeEditor(hasModel = true, hasTextFocus = false) {
    const calls: string[] = []
    return {
        calls,
        focus: vi.fn(() => calls.push('focus')),
        trigger: vi.fn((_source: string, id: string) => calls.push(`trigger ${id}`)),
        getModel: () => (hasModel ? {} : null),
        hasTextFocus: () => hasTextFocus,
    }
}

describe('runEditorAction', () => {
    let frames: Array<() => void>

    beforeEach(() => {
        frames = []
        vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("focuses the editor, then runs Monaco's action, a frame later so a closing menu has let go of focus", () => {
        const editor = fakeEditor()

        runEditorAction(editor as never, 'actions.find')
        expect(editor.calls).toEqual([])

        frames.forEach((frame) => frame())
        expect(editor.calls).toEqual(['focus', 'trigger actions.find'])
    })

    it('does nothing once the editor has no file in it', () => {
        const editor = fakeEditor(false)

        runEditorAction(editor as never, 'undo')
        frames.forEach((frame) => frame())

        expect(editor.calls).toEqual([])
    })
})

describe('runInEditor', () => {
    let frames: Array<() => void>

    beforeEach(() => {
        frames = []
        vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('runs at once from a shortcut typed in the editor, so the next key lands after it', () => {
        const editor = fakeEditor(true, true)
        const run = vi.fn()

        runInEditor(editor as never, run)

        expect(run).toHaveBeenCalledTimes(1)
        expect(frames).toHaveLength(0)
    })

    it('from a menu or the palette, focuses the editor a frame later and then runs, while a file is open', () => {
        const editor = fakeEditor()
        const run = vi.fn(() => editor.calls.push('run'))

        runInEditor(editor as never, run)
        expect(editor.calls).toEqual([])
        frames.forEach((frame) => frame())
        expect(editor.calls).toEqual(['focus', 'run'])

        const closed = fakeEditor(false)
        runInEditor(closed as never, run)
        frames.forEach((frame) => frame())
        expect(closed.calls).toEqual([])
    })
})
