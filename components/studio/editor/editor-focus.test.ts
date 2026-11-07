import { describe, expect, it, vi } from 'vitest'
import { focusEditorFor, registerEditorFocus } from '@/components/studio/editor/editor-focus'

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
})
