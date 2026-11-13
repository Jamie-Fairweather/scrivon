import { describe, expect, it, vi } from 'vitest'
import { focusEditorFor, focusEditorNow, registerEditorFocus, registerEditorFocusNow } from '@/components/studio/editor/editor-focus'

describe('editor focus registry', () => {
    it('passes the request to the editor panel that registered, and to nothing once it is gone', () => {
        const panel = vi.fn()
        const unregister = registerEditorFocus(panel)

        focusEditorFor('/ws/a.md')
        expect(panel).toHaveBeenCalledWith('/ws/a.md')

        unregister()
        focusEditorFor('/ws/b.md')
        expect(panel).toHaveBeenCalledTimes(1)
    })

    it('keeps a newer panel when an older one goes away', () => {
        const older = vi.fn()
        const newer = vi.fn()
        const unregisterOlder = registerEditorFocus(older)
        const unregisterNewer = registerEditorFocus(newer)

        unregisterOlder()
        focusEditorFor('/ws/a.md')

        expect(older).not.toHaveBeenCalled()
        expect(newer).toHaveBeenCalledWith('/ws/a.md')
        unregisterNewer()
    })

    it('focuses the editor now through the panel, and says no once the panel is gone', () => {
        const older = vi.fn(() => false)
        const newer = vi.fn(() => true)
        const unregisterOlder = registerEditorFocusNow(older)
        const unregisterNewer = registerEditorFocusNow(newer)
        unregisterOlder()

        expect(focusEditorNow()).toBe(true)
        expect(older).not.toHaveBeenCalled()

        unregisterNewer()
        expect(focusEditorNow()).toBe(false)
        expect(newer).toHaveBeenCalledTimes(1)
    })
})
