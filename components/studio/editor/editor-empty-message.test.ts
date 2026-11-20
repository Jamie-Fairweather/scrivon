import { describe, expect, it } from 'vitest'
import { editorEmptyMessage } from './editor-empty-message'

describe('editorEmptyMessage', () => {
    it('points to the explorer outside focus mode', () => {
        expect(editorEmptyMessage(false, 'Ctrl+Shift+N')).toBe('Select a file from the explorer or create a new file.')
    })

    it('says how to leave focus mode, where the explorer is hidden', () => {
        expect(editorEmptyMessage(true, 'Ctrl+Shift+N')).toBe('Focus mode is on. Press Esc to leave it, or Ctrl+Shift+N to open a file.')
        // Go to File's keys cleared in Keyboard settings.
        expect(editorEmptyMessage(true)).toBe('Focus mode is on. Press Esc to leave it.')
    })
})
