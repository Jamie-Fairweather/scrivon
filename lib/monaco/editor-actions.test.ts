import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runEditorAction } from '@/lib/monaco/editor-actions'

function fakeEditor(hasModel = true) {
    const calls: string[] = []
    return {
        calls,
        focus: vi.fn(() => calls.push('focus')),
        trigger: vi.fn((_source: string, id: string) => calls.push(`trigger ${id}`)),
        getModel: () => (hasModel ? {} : null),
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
